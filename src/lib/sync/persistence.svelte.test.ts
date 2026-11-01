// A browser that refuses IndexedDB must degrade to an in-memory session, not hang.
//
// Runs in the browser project because `attachPersistence` is guarded on `browser` and is a
// no-op under the node project, so this path is only reachable here.
//
// The bug this pins: y-indexeddb builds `whenSynced` resolve-only
// (`y-indexeddb.js:80` — `promise.create(resolve => this.on('synced', …))`) and then does
// `this._db.then(…)` with no `.catch` (`:82`). An `openDB` failure therefore becomes an
// unhandled rejection while `whenSynced` stays pending forever — so every loading skeleton
// in the app, which gates on that promise, spins indefinitely with no error and no way
// forward. `IssueStore` had a rejection handler for exactly this case that could never run.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { attachPersistence } from './persistence.js';
import * as Y from 'yjs';
import { REAL_ID, poisonedSnapshot, wellFormedIssue } from './junk-entries.fixture.js';
import { createDoc, getIssuesMap } from './doc.js';
import { IssueStore } from '$lib/state/issues.svelte.js';

/**
 * Swallows the one rejection this scenario produces that no caller can reach.
 *
 * y-indexeddb does `this._db.then(db => …)` (`:82`) with no `.catch`, and that *derived*
 * promise is internal to the library — attaching a handler to `_db` from outside (which
 * `attachPersistence` does) creates a different derived promise and cannot mark the
 * library's own one as handled. So a browser with blocked storage logs exactly one
 * unhandled rejection. That is pre-existing library behaviour, not something this module
 * introduced, and the app recovers regardless. It is suppressed for the whole file rather
 * than per-test because it surfaces a task or two after the promise it belongs to settles.
 */
const swallow = (event: PromiseRejectionEvent) => event.preventDefault();

beforeAll(() => window.addEventListener('unhandledrejection', swallow));
afterAll(() => window.removeEventListener('unhandledrejection', swallow));

afterEach(() => {
	vi.unstubAllGlobals();
});

/** Stands in for a browser that refuses to open a database at all. */
function stubBlockedIndexedDb() {
	vi.stubGlobal('indexedDB', {
		open() {
			const request: Record<string, unknown> = { error: new Error('blocked') };
			// lib0's openDB assigns onerror/onsuccess synchronously after calling open(),
			// so the failure has to be delivered on a later task than this one.
			setTimeout(() => {
				const onerror = request.onerror as ((event: unknown) => void) | undefined;
				onerror?.({ target: { error: new Error('blocked') } });
			}, 0);
			return request;
		}
	});
}

describe('attachPersistence when IndexedDB is unavailable', () => {
	it('rejects whenSynced instead of leaving it pending forever', async () => {
		stubBlockedIndexedDb();
		const persistence = attachPersistence(createDoc(), `blocked-${crypto.randomUUID()}`);

		// The whole point: this settles. Before the fix it stayed pending forever and this
		// assertion would time out rather than pass.
		await expect(persistence.whenSynced).rejects.toThrow();
		// Let the library's own unreachable rejection surface while the suppressor above is
		// still installed, rather than after this test has handed back control.
		await new Promise((resolve) => setTimeout(resolve, 20));
	});

	it('still resolves normally when IndexedDB works', async () => {
		const persistence = attachPersistence(createDoc(), `ok-${crypto.randomUUID()}`);
		await expect(persistence.whenSynced).resolves.toBeUndefined();
		await persistence.destroy();
	});

	it('leaves the store usable and honest about not having saved anything', async () => {
		// The contract a visitor actually experiences: the app finishes loading rather than
		// spinning forever, and the connection popover stops claiming "Saved on this device"
		// for a browser where nothing was saved at all.
		stubBlockedIndexedDb();
		const store = new IssueStore(`blocked-store-${crypto.randomUUID()}`);
		try {
			await vi.waitFor(() => expect(store.synced).toBe(true));
			expect(store.persisted).toBe(false);

			// And it is still a working in-memory session, not a dead one.
			store.create({ title: 'Written with no database' });
			expect(store.all.map((issue) => issue.title)).toEqual(['Written with no database']);
		} finally {
			store.destroy();
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
	});
});

describe('a row saved while the document held a struct of no length', () => {
	it('loads, rather than leaving the visitor on the skeleton', async () => {
		// y-indexeddb starts its fetch without keeping the promise, so a throw while it applies a row
		// reaches nobody, and 'synced' never fires. Its compaction is what used to write this row.
		const workspaceId = `poisoned-${crypto.randomUUID()}`;
		const peer = createDoc();
		getIssuesMap(peer).set(REAL_ID, wellFormedIssue({ title: 'Kept' }));
		const row = poisonedSnapshot(Y.encodeStateAsUpdate(peer));

		const earlier = attachPersistence(createDoc(), workspaceId);
		await earlier.whenSynced;
		const database = await (earlier.provider as NonNullable<typeof earlier.provider>)._db;
		await new Promise<void>((resolve, reject) => {
			const write = database.transaction('updates', 'readwrite');
			write.objectStore('updates').add(row);
			write.oncomplete = () => resolve();
			write.onerror = () => reject(write.error);
		});
		await earlier.destroy();

		const store = new IssueStore(workspaceId);
		try {
			await vi.waitFor(() => expect(store.synced).toBe(true), { timeout: 3_000 });
			expect(store.persisted).toBe(true);
			expect(store.all.map((issue) => issue.title)).toEqual(['Kept']);
		} finally {
			store.destroy();
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
	});
});
