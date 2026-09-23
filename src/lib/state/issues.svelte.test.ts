// Phase 3 acceptance: a Yjs mutation propagates into reactive state, and the derived
// query index recomputes. Runs in the browser project so Svelte runes are available.
//
// These tests deliberately observe the derived index through an $effect rather than
// reading getters imperatively — the point is to prove *reactivity*. Reading getters
// after a mutation would pass even with a non-reactive Map, because Yjs fires observeDeep
// synchronously; the $effect only re-runs if the projection is genuinely reactive.

import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORKSPACE_ID, WORKSPACE_STORAGE_KEY } from '$lib/model/workspace.js';
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

describe('IssueStore.seedDemo', () => {
	it('never runs on its own — a brand-new store starts empty', () => {
		// Phase 12's actual contract: the empty state's "Load example issues" button is the
		// only caller of seedDemo(). `query.total === 0` is also true for a genuinely fresh
		// workspace, and several e2e suites assert exactly that after nothing but
		// `new IssueStore(...)` — if the constructor (or sessionWorkspace, or anything else
		// on the construction path) ever called seedDemo() on its own, this is where that
		// regression would be caught, rather than as a wave of unrelated e2e failures.
		const store = makeStore();
		expect(store.all).toHaveLength(0);
	});

	it('populates the workspace when asked, in one delta', () => {
		const store = makeStore();
		let batches = 0;
		store.onChange(() => (batches += 1));
		const ids = store.seedDemo();
		expect(ids.length).toBeGreaterThan(0);
		expect(store.all).toHaveLength(ids.length);
		expect(batches).toBe(1);
	});
});

describe('IssueStore session workspace', () => {
	/**
	 * Builds a store the way the app itself does — from the URL and localStorage rather than
	 * from an explicit id — with both swapped for the duration and put straight back.
	 *
	 * `stored` is read before the restore, because what this path writes to localStorage is
	 * half of what it does: the id it picks becomes that browser's workspace permanently.
	 */
	function sessionStore(search: string, remembered: string | null) {
		const url = location.href;
		const previous = localStorage.getItem(WORKSPACE_STORAGE_KEY);
		history.replaceState(null, '', `${location.pathname}${search}${location.hash}`);
		if (remembered === null) localStorage.removeItem(WORKSPACE_STORAGE_KEY);
		else localStorage.setItem(WORKSPACE_STORAGE_KEY, remembered);
		try {
			const store = new IssueStore();
			stores.push(store);
			return { store, stored: localStorage.getItem(WORKSPACE_STORAGE_KEY) };
		} finally {
			history.replaceState(null, '', url);
			if (previous === null) localStorage.removeItem(WORKSPACE_STORAGE_KEY);
			else localStorage.setItem(WORKSPACE_STORAGE_KEY, previous);
		}
	}

	const REMEMBERED = 'w00000000000000000000000000000002';

	it('never joins the guessable workspace, however it is asked to', () => {
		// The regression: `?ws=default` resolved to the literal workspace 'default' for any
		// browser that had been here before, and this is the code that then wrote it to
		// localStorage as that browser's permanent workspace. After deploy that is one real
		// Durable Object room, and it is the only id anyone can guess (ADR 0004).
		const returning = sessionStore(`?ws=${DEFAULT_WORKSPACE_ID}`, REMEMBERED);
		expect(returning.store.workspaceId).toBe(REMEMBERED);
		expect(returning.stored).toBe(REMEMBERED);

		const first = sessionStore(`?ws=${DEFAULT_WORKSPACE_ID}`, null);
		expect(first.store.workspaceId).toMatch(/^w[0-9a-f]{32}$/);
		expect(first.stored).toBe(first.store.workspaceId);

		// A browser an earlier build already stranded in it is moved out on this load.
		const stranded = sessionStore('', DEFAULT_WORKSPACE_ID);
		expect(stranded.store.workspaceId).toMatch(/^w[0-9a-f]{32}$/);
		expect(stranded.stored).toBe(stranded.store.workspaceId);
	});

	it('carries a share link into the workspace it names, and remembers it', () => {
		const shared = 'w00000000000000000000000000000003';
		const { store, stored } = sessionStore(`?ws=${shared}`, REMEMBERED);
		expect(store.workspaceId).toBe(shared);
		expect(stored).toBe(shared);
		expect(store.invalidWorkspaceParam).toBeNull();
	});

	it('reports a malformed link instead of silently opening something else', () => {
		const { store } = sessionStore('?ws=not%20a%20valid%20id!', REMEMBERED);
		expect(store.workspaceId).toBe(REMEMBERED);
		// The raw value survives to the UI, which is what lets the notice show what was wrong.
		expect(store.invalidWorkspaceParam).toBe('not a valid id!');
		store.dismissInvalidWorkspaceParam();
		expect(store.invalidWorkspaceParam).toBeNull();
	});

	it('has nothing to report when the workspace came from an explicit id', () => {
		expect(makeStore().invalidWorkspaceParam).toBeNull();
	});
});

describe('IssueStore.settled', () => {
	it('is not true until the local load has finished', () => {
		// `settled` gates the empty state's seeding button, and seeding a workspace that is
		// still arriving appends fourteen issues into someone else's backlog for good.
		expect(makeStore().settled).toBe(false);
	});

	it('needs nothing beyond the local load when there is no relay to wait for', async () => {
		// Unit tests run with no PUBLIC_RELAY_HOST, so attachRelay reports 'local' — there is
		// no round trip pending and the empty state is telling the truth as soon as it loads.
		const store = makeStore();
		await vi.waitFor(() => expect(store.synced).toBe(true));
		expect(store.connection).toBe('local');
		expect(store.settled).toBe(true);
	});
});
