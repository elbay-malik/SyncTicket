// The search worker: a FlexSearch index, and — only if the user asks for it — an embedding
// model. Both live off the main thread because both can block for long enough to drop
// frames, the model spectacularly so.
//
// Nothing here is imported by the app directly. The client references this file only
// through `new URL('./worker.ts', import.meta.url)`, which keeps FlexSearch and the
// embedding library out of the server bundle entirely.

import { LexicalIndex } from './lexical.js';
import { cosineSimilarity, fuseRanks, topBySimilarity, type Scored } from './rank.js';
import type { FromWorker, SearchDoc, SemanticStatus, ToWorker } from './protocol.js';

/**
 * The worker's global, typed by hand.
 *
 * SvelteKit's generated tsconfig compiles this file with the DOM lib, so `self` is a
 * `Window` and `postMessage` has the wrong overloads. Adding the webworker lib instead
 * collides with DOM across dozens of declarations, so one local interface and one cast is
 * the cheaper trade — and it types `event.data`, which `self.onmessage` would not.
 */
interface WorkerScope {
	postMessage(message: FromWorker): void;
	addEventListener(type: 'message', listener: (event: MessageEvent<ToWorker>) => void): void;
}

const ctx = self as unknown as WorkerScope;

const lexical = new LexicalIndex();

/** The indexed text and, once embedded, its vector. A null vector means "not yet". */
const corpus = new Map<string, { text: string; vector: Float32Array | null }>();

let semantic: SemanticStatus = 'off';
let embed: ((texts: string[]) => Promise<Float32Array[]>) | null = null;

/**
 * Bumped by every corpus mutation. The embedding pass captures it before each `await` and
 * abandons itself if it changed, so a batch can never write vectors for text that has since
 * been edited or deleted.
 */
let generation = 0;
let embedding = false;

function post(message: FromWorker): void {
	ctx.postMessage(message);
}

function status(next: SemanticStatus, progress?: number): void {
	semantic = next;
	post(
		progress === undefined ? { kind: 'status', semantic } : { kind: 'status', semantic, progress }
	);
}

function applyUpsert(docs: readonly SearchDoc[]): void {
	lexical.upsert(docs);
	for (const doc of docs) {
		const existing = corpus.get(doc.id);
		// Only drop the vector when the indexed text actually changed: a status or priority
		// edit rewrites the document but not a single word this index cares about.
		if (existing && existing.text === doc.text) continue;
		corpus.set(doc.id, { text: doc.text, vector: null });
	}
	generation += 1;
}

function applyRemove(ids: readonly string[]): void {
	lexical.remove(ids);
	for (const id of ids) corpus.delete(id);
	generation += 1;
}

/** True when every indexed document has a vector for its current text. */
function semanticIsComplete(): boolean {
	if (semantic !== 'ready') return false;
	for (const entry of corpus.values()) if (!entry.vector) return false;
	return true;
}

/**
 * Embeds documents that lack a current vector, a few at a time.
 *
 * ONNX inference is synchronous on the thread that calls it, so embedding ten thousand
 * documents in one pass would freeze this worker for minutes and queries would sit behind
 * it. Small batches with a yield in between keep the message queue draining, which is what
 * makes "lexical results while the model warms" true after the download as well as during
 * it.
 */
async function embedPending(): Promise<void> {
	if (embedding || !embed) return;
	embedding = true;
	try {
		for (;;) {
			const pending = [...corpus.entries()].filter(([, entry]) => !entry.vector).slice(0, 8);
			if (pending.length === 0) return;
			const mine = generation;
			const vectors = await embed(pending.map(([, entry]) => entry.text));
			// The corpus changed while we were away; those vectors may already be stale.
			if (mine !== generation) continue;
			for (let i = 0; i < pending.length; i += 1) {
				const id = pending[i]?.[0];
				const vector = vectors[i];
				const entry = id === undefined ? undefined : corpus.get(id);
				if (entry && vector && entry.text === pending[i]?.[1].text) entry.vector = vector;
			}
			// Hand the queue back so a query typed during the pass is answered now, not later.
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
	} finally {
		embedding = false;
	}
}

/** How many times a failed warm-up retries itself before reporting 'failed'. */
const WARM_RETRIES = 2;
/** Backoff between attempts. Short: this is recovering a page already open, not a cold start. */
const WARM_RETRY_DELAY_MS = 800;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Loads the embedding pipeline, retrying transient failures before giving up.
 *
 * Fetching ~46 MB (the model plus the ONNX runtime) over one connection has room to fail
 * for reasons that have nothing to do with where the bytes come from — self-hosting them
 * removes the dependency on Hugging Face and jsDelivr being reachable, but does not make
 * the browser's own network stack infallible. A single blip used to be permanent: nothing
 * called `warm()` again, and the palette was stuck on "unavailable" for the rest of the
 * session. `warm()`'s own re-entrancy guard (`semantic === 'loading' || 'ready'`) does not
 * block a retry — 'failed' is a normal state to call it again from — so the user's own
 * "Try again" click in the palette and this internal retry share the same path.
 */
async function loadPipeline(
	onProgress: (progress: number) => void
): Promise<(texts: string[]) => Promise<Float32Array[]>> {
	// Imported here and nowhere else: this is what keeps the library out of the bundle every
	// visitor downloads. It needs Vite's worker format to be 'es', or the import is inlined
	// into the worker chunk and ships to everyone regardless.
	const { pipeline, env } = await import('@huggingface/transformers');
	// Self-hosted, deliberately with no remote fallback: `scripts/fetch-search-assets.mjs`
	// vendors both the model and the ONNX runtime as static assets served by this app, so a
	// live demo's "add meaning search" never depends on Hugging Face or jsDelivr being
	// reachable at that moment. `allowRemoteModels = false` is what makes that a promise
	// rather than a preference — without it, a missing local file would silently fall
	// through to the network instead of failing loudly into the lexical-only path below, and
	// a demo would never learn its self-hosting had quietly broken.
	env.allowLocalModels = true;
	env.allowRemoteModels = false;
	env.localModelPath = '/models/';
	// The type is `Partial<onnxruntime-common Env>`, but `wasm` is unconditionally
	// initialised to `{}` in that package's own Env implementation (env-impl.js) — the
	// optionality is a type-only artifact, never actually undefined at runtime.
	env.backends.onnx.wasm!.wasmPaths = '/ort/';
	const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
		dtype: 'q8',
		progress_callback: (event: unknown) => {
			const progress = (event as { progress?: number }).progress;
			// transformers.js reports 0–100 here (`hub/utils.js`'s `readResponse`: `progress =
			// (loaded / total) * 100`), not the 0–1 this module's own protocol documents —
			// passed through unconverted this showed "10000%" partway through a real load.
			if (typeof progress === 'number') onProgress(progress / 100);
		}
	});
	return async (texts: string[]) => {
		const output = await extractor(texts, { pooling: 'mean', normalize: true });
		const list = output.tolist() as number[][];
		return list.map((row) => Float32Array.from(row));
	};
}

async function warm(): Promise<void> {
	if (semantic === 'loading' || semantic === 'ready') return;
	status('loading', 0);
	for (let attempt = 0; attempt <= WARM_RETRIES; attempt += 1) {
		try {
			embed = await loadPipeline((progress) => status('loading', progress));
			status('ready');
			void embedPending();
			return;
		} catch {
			if (attempt < WARM_RETRIES) {
				status('loading', 0);
				await sleep(WARM_RETRY_DELAY_MS);
				continue;
			}
			// Every attempt failed. Degrade to lexical search rather than break search — the
			// palette's "Try again" button calls `warm()` fresh from here if the user wants
			// another go, e.g. once whatever caused this has cleared.
			embed = null;
			status('failed');
		}
	}
}

async function answer(id: number, text: string, limit: number): Promise<void> {
	const lexicalIds = lexical.query(text, limit);
	// Semantic results are only claimed when every document actually has a current vector;
	// otherwise the ranking would silently cover part of the corpus while calling itself
	// hybrid.
	if (!embed || !semanticIsComplete()) {
		post({ kind: 'results', id, ids: lexicalIds, mode: 'lexical' });
		return;
	}
	try {
		const [queryVector] = await embed([text]);
		if (!queryVector) {
			post({ kind: 'results', id, ids: lexicalIds, mode: 'lexical' });
			return;
		}
		const scored: Scored[] = [];
		for (const [docId, entry] of corpus) {
			if (entry.vector)
				scored.push({ id: docId, score: cosineSimilarity(queryVector, entry.vector) });
		}
		const semanticIds = topBySimilarity(scored, limit);
		post({
			kind: 'results',
			id,
			ids: fuseRanks([lexicalIds, semanticIds]).slice(0, limit),
			mode: 'hybrid'
		});
	} catch {
		post({ kind: 'results', id, ids: lexicalIds, mode: 'lexical' });
	}
}

ctx.addEventListener('message', (event) => {
	const message = event.data;
	switch (message.kind) {
		case 'sync':
			// Drop the old ids from the index before forgetting what they were.
			lexical.remove([...corpus.keys()]);
			corpus.clear();
			applyUpsert(message.docs);
			void embedPending();
			return;
		case 'upsert':
			applyUpsert(message.docs);
			void embedPending();
			return;
		case 'remove':
			applyRemove(message.ids);
			return;
		case 'query':
			void answer(message.id, message.text, message.limit);
			return;
		case 'warm':
			void warm();
			return;
	}
});
