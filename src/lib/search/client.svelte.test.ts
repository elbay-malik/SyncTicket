// The bridge between the store and the search worker.
//
// Everything here is about ORDERING, which is the only thing this class can get wrong and the
// one thing reading it does not make obvious. The worker answers asynchronously and the user
// keeps typing, so a reply can arrive for a question nobody is asking any more. The sequence
// counter is the whole defence, and `search('')` bumping it is the subtle half: a clear has to
// invalidate an in-flight reply, or a slow semantic pass repopulates a list the user emptied.
//
// `Worker` is stubbed rather than real. A real worker here would load FlexSearch and, on the
// semantic path, ~46 MB of model — and none of that is what these tests are about. Stubbing the
// global rather than adding an injection seam keeps the production class free of a constructor
// parameter that exists only for tests; `new Worker(new URL('./worker.ts', import.meta.url))` is
// also the literal form Vite scans for, so it is not a line to make configurable lightly.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { SearchClient } from './client.svelte.js';
import type { FromWorker, SearchDoc, ToWorker } from './protocol.js';
import type { IssueDelta } from '$lib/state/issues.svelte.js';
import type { IssueStore } from '$lib/state/issues.svelte.js';

/** Records what the client posts, and lets a test answer as the worker would. */
class FakeWorker {
	static last: FakeWorker | null = null;
	static constructed = 0;

	posted: ToWorker[] = [];
	terminated = false;
	#listeners: Array<(event: MessageEvent<FromWorker>) => void> = [];

	constructor() {
		FakeWorker.last = this;
		FakeWorker.constructed += 1;
	}

	postMessage(message: ToWorker): void {
		this.posted.push(message);
	}

	addEventListener(_type: 'message', listener: (event: MessageEvent<FromWorker>) => void): void {
		this.#listeners.push(listener);
	}

	terminate(): void {
		this.terminated = true;
	}

	/** Delivers a worker reply on the main thread, the way a real `message` event would. */
	reply(message: FromWorker): void {
		for (const listener of this.#listeners) {
			listener(new MessageEvent('message', { data: message }));
		}
		flushSync();
	}

	/** Only the queries, which is what the ordering assertions care about. */
	get queries(): Array<Extract<ToWorker, { kind: 'query' }>> {
		return this.posted.filter((m): m is Extract<ToWorker, { kind: 'query' }> => m.kind === 'query');
	}
}

/** Enough of IssueStore for `start`: the two members it reads, and nothing else. */
function fakeStore(
	options: {
		synced?: boolean;
		all?: Array<{ id: string; title: string; description: string }>;
	} = {}
) {
	let emit: ((delta: IssueDelta) => void) | null = null;
	const store = {
		synced: options.synced ?? true,
		all: options.all ?? [],
		onChange(listener: (delta: IssueDelta) => void) {
			emit = listener;
			return () => {
				emit = null;
			};
		}
	};
	return {
		store: store as unknown as IssueStore,
		/**
		 * `upserted` is typed at the three fields `toSearchDoc` actually reads, not at `Issue`.
		 * Building a whole Issue here would add seven fields no code under test looks at, and
		 * would quietly make the fixture a statement about the issue model rather than about
		 * the search bridge.
		 */
		change(delta: { upserted?: SearchSource[]; removed?: string[]; reset?: boolean }) {
			emit?.({
				upserted: (delta.upserted ?? []) as unknown as IssueDelta['upserted'],
				removed: delta.removed ?? [],
				reset: delta.reset ?? false
			});
		},
		get attached() {
			return emit !== null;
		}
	};
}

/** Exactly what `toSearchDoc` reads off an issue, and nothing else. */
type SearchSource = { id: string; title: string; description: string };

const issue = (id: string, title = `Issue ${id}`, description = ''): SearchSource => ({
	id,
	title,
	description
});
const results = (
	id: number,
	ids: string[],
	mode: 'lexical' | 'hybrid' = 'lexical'
): FromWorker => ({
	kind: 'results',
	id,
	ids,
	mode
});

describe('SearchClient', () => {
	let OriginalWorker: typeof Worker;

	beforeEach(() => {
		OriginalWorker = globalThis.Worker;
		FakeWorker.last = null;
		FakeWorker.constructed = 0;
		globalThis.Worker = FakeWorker as unknown as typeof Worker;
	});

	afterEach(() => {
		globalThis.Worker = OriginalWorker;
		vi.restoreAllMocks();
	});

	describe('ordering', () => {
		it('ignores a reply to a query that has been superseded', () => {
			const client = new SearchClient();
			client.start(fakeStore().store);
			const worker = FakeWorker.last!;

			client.search('first');
			client.search('second');
			const [first, second] = worker.queries;

			// Out of order on purpose: the slow first query answers after the second.
			worker.reply(results(second!.id, ['b']));
			worker.reply(results(first!.id, ['a']));

			expect(client.ids).toEqual(['b']);
		});

		it('drops a reply that arrives after the query was cleared', () => {
			// The documented reason `search('')` bumps the sequence at all. Without it a semantic
			// pass that started before the user emptied the box would refill an empty palette.
			const client = new SearchClient();
			client.start(fakeStore().store);
			const worker = FakeWorker.last!;

			client.search('slow');
			const inFlight = worker.queries[0]!.id;
			client.search('');
			expect(client.ids).toEqual([]);

			worker.reply(results(inFlight, ['stale']));
			expect(client.ids).toEqual([]);
		});

		it('posts no query for whitespace, and reports lexical mode again', () => {
			const client = new SearchClient();
			client.start(fakeStore().store);
			const worker = FakeWorker.last!;

			client.search('real');
			worker.reply(results(worker.queries[0]!.id, ['x'], 'hybrid'));
			expect(client.mode).toBe('hybrid');

			client.search('   ');
			expect(worker.queries).toHaveLength(1);
			expect(client.ids).toEqual([]);
			expect(client.mode).toBe('lexical');
		});

		it('mints ids that keep rising across a clear', () => {
			// A worker restart must not be able to collide with an id already in flight, which is
			// why the counter lives here and never resets.
			const client = new SearchClient();
			client.start(fakeStore().store);
			const worker = FakeWorker.last!;

			client.search('a');
			client.search('');
			client.search('b');
			const ids = worker.queries.map((q) => q.id);
			expect(ids).toHaveLength(2);
			expect(ids[1]!).toBeGreaterThan(ids[0]! + 1);
		});

		it('applies a status message whatever query is current', () => {
			// Status carries no id, so it must not be filtered by the sequence check.
			const client = new SearchClient();
			client.start(fakeStore().store);
			const worker = FakeWorker.last!;

			client.search('anything');
			worker.reply({ kind: 'status', semantic: 'loading', progress: 0.5 });
			expect(client.semantic).toBe('loading');
			expect(client.progress).toBe(0.5);

			// Progress is optional, and omitting it must not reset the last value to 0.
			worker.reply({ kind: 'status', semantic: 'ready' });
			expect(client.semantic).toBe('ready');
			expect(client.progress).toBe(0.5);
		});
	});

	describe('corpus', () => {
		it('seeds the worker from an already-synced store', () => {
			const client = new SearchClient();
			client.start(fakeStore({ synced: true, all: [issue('1', 'Hello', 'World')] }).store);

			expect(FakeWorker.last!.posted[0]).toEqual({
				kind: 'sync',
				docs: [{ id: '1', title: 'Hello', text: 'Hello\nWorld' }] satisfies SearchDoc[]
			});
		});

		it('sends nothing until the store has loaded', () => {
			const client = new SearchClient();
			client.start(fakeStore({ synced: false, all: [issue('1')] }).store);
			expect(FakeWorker.last!.posted).toEqual([]);
		});

		it('replaces the whole corpus on a reset rather than merging into it', () => {
			// A reset is the post-load rebuild. Treating it as an upsert would leave issues that
			// have since been deleted findable forever.
			const client = new SearchClient();
			const harness = fakeStore({ synced: false });
			client.start(harness.store);
			harness.change({ upserted: [issue('1')], reset: true });

			expect(FakeWorker.last!.posted).toEqual([
				{ kind: 'sync', docs: [{ id: '1', title: 'Issue 1', text: 'Issue 1\n' }] }
			]);
		});

		it('splits a mixed delta into an upsert and a removal', () => {
			const client = new SearchClient();
			const harness = fakeStore({ synced: false });
			client.start(harness.store);
			harness.change({ upserted: [issue('2')], removed: ['1'] });

			expect(FakeWorker.last!.posted.map((m) => m.kind)).toEqual(['upsert', 'remove']);
		});
	});

	describe('lifecycle', () => {
		it('starts one worker however many times it is asked', () => {
			const client = new SearchClient();
			const first = fakeStore();
			client.start(first.store);
			client.start(fakeStore().store);
			expect(FakeWorker.constructed).toBe(1);
		});

		it('detaches from the store and terminates the worker on destroy', () => {
			// A leaked subscription would keep posting into a terminated worker, and a leaked
			// worker survives a dev reload — which is why the module has an import.meta.hot hook.
			const client = new SearchClient();
			const harness = fakeStore();
			client.start(harness.store);
			const worker = FakeWorker.last!;

			client.destroy();
			expect(worker.terminated).toBe(true);
			expect(harness.attached).toBe(false);
		});

		it('survives a query after destroy instead of throwing', () => {
			const client = new SearchClient();
			client.start(fakeStore().store);
			client.destroy();
			expect(() => client.search('after')).not.toThrow();
		});

		it('can be restarted after being destroyed', () => {
			const client = new SearchClient();
			client.start(fakeStore().store);
			client.destroy();
			client.start(fakeStore({ synced: true, all: [issue('1')] }).store);
			expect(FakeWorker.constructed).toBe(2);
			expect(FakeWorker.last!.posted[0]?.kind).toBe('sync');
		});
	});
});
