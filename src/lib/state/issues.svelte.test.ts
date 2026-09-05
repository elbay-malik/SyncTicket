// Phase 3 acceptance: a Yjs mutation propagates into reactive state, and the derived
// query index recomputes. Runs in the browser project so Svelte runes are available.
//
// These tests deliberately observe the derived index through an $effect rather than
// reading getters imperatively — the point is to prove *reactivity*. Reading getters
// after a mutation would pass even with a non-reactive Map, because Yjs fires observeDeep
// synchronously; the $effect only re-runs if the projection is genuinely reactive.

import { flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { IssueStore } from './issues.svelte.js';
import { IssueQuery } from './queries.svelte.js';

const stores: IssueStore[] = [];

function makeStore() {
	const store = new IssueStore(`test-${crypto.randomUUID()}`);
	stores.push(store);
	return store;
}

afterEach(() => {
	while (stores.length) stores.pop()?.destroy();
});

describe('IssueStore → IssueQuery reactivity', () => {
	it('re-runs a subscriber when a CRDT mutation changes the projection', () => {
		const store = makeStore();
		const query = new IssueQuery(store);

		const seen: number[] = [];
		const cleanup = $effect.root(() => {
			$effect(() => {
				seen.push(query.results.length);
			});
		});
		flushSync();
		expect(seen.at(-1)).toBe(0);

		// A create must reactively push the subscriber to 1 (fails with a plain Map).
		const id = store.create({ title: 'Alpha', status: 'todo' });
		flushSync();
		expect(seen.at(-1)).toBe(1);
		expect(query.results[0]?.title).toBe('Alpha');

		// An in-place field edit must re-snapshot the issue reactively.
		store.update(id, { status: 'done', priority: 'high' });
		flushSync();
		expect(query.results[0]?.status).toBe('done');
		expect(query.results[0]?.priority).toBe('high');

		// A delete must reactively push the subscriber back to 0.
		store.remove(id);
		flushSync();
		expect(seen.at(-1)).toBe(0);

		cleanup();
	});

	it('recomputes when filter and sort controls change', () => {
		const store = makeStore();
		const query = new IssueQuery(store);

		store.create({ title: 'A todo', status: 'todo', priority: 'low' });
		store.create({ title: 'A finished thing', status: 'done', priority: 'urgent' });
		flushSync();
		expect(query.total).toBe(2);
		expect(query.counts.todo).toBe(1);

		query.status = 'done';
		flushSync();
		expect(query.results.map((i) => i.title)).toEqual(['A finished thing']);

		query.status = 'all';
		query.text = 'todo';
		flushSync();
		expect(query.results.map((i) => i.title)).toEqual(['A todo']);

		// Filter + non-default sort compose (priority sort over the filtered set).
		query.text = '';
		query.sort = 'priority';
		flushSync();
		expect(query.results.map((i) => i.title)).toEqual(['A finished thing', 'A todo']);
	});
});

describe('IssueStore.onChange', () => {
	it('reports per-batch deltas and stops when unsubscribed', () => {
		const store = makeStore();
		const deltas: Array<{ upserted: string[]; removed: string[]; reset: boolean }> = [];
		const off = store.onChange((delta) =>
			deltas.push({
				upserted: delta.upserted.map((issue) => issue.title),
				removed: [...delta.removed],
				reset: delta.reset
			})
		);

		const id = store.create({ title: 'Indexed' });
		expect(deltas.at(-1)).toEqual({ upserted: ['Indexed'], removed: [], reset: false });

		store.update(id, { title: 'Reindexed' });
		expect(deltas.at(-1)).toEqual({ upserted: ['Reindexed'], removed: [], reset: false });

		store.remove(id);
		expect(deltas.at(-1)).toEqual({ upserted: [], removed: [id], reset: false });

		const before = deltas.length;
		off();
		store.create({ title: 'Unheard' });
		expect(deltas).toHaveLength(before);
	});

	it('coalesces a bulk write into a single delta', () => {
		// The search index must not receive one message per issue when seeding thousands.
		const store = makeStore();
		let batches = 0;
		let total = 0;
		store.onChange((delta) => {
			batches += 1;
			total += delta.upserted.length;
		});
		store.seed(50, { seed: 1 });
		expect(batches).toBe(1);
		expect(total).toBe(50);
	});
});
