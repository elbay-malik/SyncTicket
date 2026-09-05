// The bridge from the search worker to the UI, in the same shape as IssueStore: a browser
// singleton, a no-op on the server, and reactive state the components read.

import { browser } from '$app/environment';
import { toSearchDoc, type FromWorker, type SearchMode, type SemanticStatus } from './protocol.js';
import type { IssueStore } from '$lib/state/issues.svelte.js';

/** How many results the palette asks for. */
export const SEARCH_LIMIT = 8;

export class SearchClient {
	#worker: Worker | null = null;
	#detach: (() => void) | null = null;
	/** Monotonic, minted here rather than in the worker so a worker restart cannot collide. */
	#sequence = 0;
	#latest = 0;

	/** Ids of the current results, freshest reply wins. */
	ids = $state<string[]>([]);
	mode = $state<SearchMode>('lexical');
	semantic = $state<SemanticStatus>('off');
	/** Download progress while `semantic` is 'loading', 0 to 1. */
	progress = $state(0);

	/**
	 * Starts the worker and keeps its corpus in step with the store.
	 *
	 * Called from the root layout's onMount rather than lazily on first search, for the same
	 * reason the issues layout preloads the detail route: the worker and its FlexSearch chunk
	 * are fetched at construction, and a user who has gone offline can no longer fetch them.
	 */
	start(store: IssueStore): void {
		if (!browser || this.#worker) return;
		// Not reactive state: `new URL(..., import.meta.url)` is the literal form Vite looks for
		// to find and bundle the worker, so it cannot become a SvelteURL.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		this.#worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
		this.#worker.addEventListener('message', this.#onMessage);

		// The projection may already be populated — the post-load rebuild emits a reset, but
		// only if it has not happened yet.
		if (store.synced) this.#post({ kind: 'sync', docs: store.all.map(toSearchDoc) });
		this.#detach = store.onChange((delta) => {
			if (delta.reset) {
				this.#post({ kind: 'sync', docs: delta.upserted.map(toSearchDoc) });
				return;
			}
			if (delta.upserted.length > 0) {
				this.#post({ kind: 'upsert', docs: delta.upserted.map(toSearchDoc) });
			}
			if (delta.removed.length > 0) {
				this.#post({ kind: 'remove', ids: [...delta.removed] });
			}
		});
	}

	/** Runs a query, or clears the results when the text is empty. */
	search(text: string, limit: number = SEARCH_LIMIT): void {
		const trimmed = text.trim();
		// Bumping the sequence on every call — including a clear — makes any reply still in
		// flight stale by construction, so a slow semantic pass cannot repopulate a list the
		// user has already emptied.
		this.#latest = ++this.#sequence;
		if (!trimmed) {
			this.ids = [];
			this.mode = 'lexical';
			return;
		}
		this.#post({ kind: 'query', id: this.#latest, text: trimmed, limit });
	}

	/** Begins downloading the embedding model. Search keeps working throughout. */
	warm(): void {
		this.#post({ kind: 'warm' });
	}

	destroy(): void {
		this.#detach?.();
		this.#detach = null;
		this.#worker?.terminate();
		this.#worker = null;
	}

	#post(message: Parameters<Worker['postMessage']>[0]): void {
		this.#worker?.postMessage(message);
	}

	#onMessage = (event: MessageEvent<FromWorker>): void => {
		const message = event.data;
		if (message.kind === 'status') {
			this.semantic = message.semantic;
			if (message.progress !== undefined) this.progress = message.progress;
			return;
		}
		// Anything but the newest query is an answer to a question no longer being asked.
		if (message.id !== this.#latest) return;
		this.ids = message.ids;
		this.mode = message.mode;
	};
}

let client: SearchClient | null = null;

/** The shared client. On the server this is inert: it never constructs a Worker. */
export function getSearchClient(): SearchClient {
	if (!client) client = new SearchClient();
	return client;
}

// Dev reloads would otherwise leave orphaned workers running.
if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		client?.destroy();
		client = null;
	});
}
