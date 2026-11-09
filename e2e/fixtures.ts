// Every test gets its own workspace.
//
// Before Phase 9 each test was isolated simply because each browser context started with an
// empty IndexedDB. A relay removes that: every context in the run would otherwise join the
// same Durable Object room, inherit issues created by other tests, and inherit them again on
// the next local run, because the room's storage outlives the process. Seeding a unique
// workspace id before any script runs restores isolation for both the database and the room.

import { test as base, expect, type Page } from '@playwright/test';
import { WORKSPACE_STORAGE_KEY, workspaceDbName } from '../src/lib/model/workspace.js';
import { GUIDE_KEY } from '../src/lib/state/guide-key.js';

export interface WorkspaceFixtures {
	/** The workspace this test owns. */
	workspaceId: string;
	/** The IndexedDB database backing it. */
	workspaceDb: string;
	/**
	 * Whether the first-visit "Try this" card may appear. Off by default: a fixed card in the
	 * corner would sit over whatever a test means to click. The guide's own tests turn it on.
	 */
	showGuide: boolean;
}

export const test = base.extend<WorkspaceFixtures>({
	showGuide: [false, { option: true }],
	// eslint-disable-next-line no-empty-pattern -- Playwright requires the fixture-args slot.
	workspaceId: async ({}, use) => {
		await use(`t${crypto.randomUUID().replace(/-/g, '')}`);
	},
	workspaceDb: async ({ workspaceId }, use) => {
		await use(workspaceDbName(workspaceId));
	},
	context: async ({ context, workspaceId, showGuide }, use) => {
		await context.addInitScript(
			([key, id, guideKey]) => {
				try {
					window.localStorage.setItem(key as string, id as string);
					if (guideKey) window.localStorage.setItem(guideKey, 'dismissed');
				} catch {
					// A context that cannot use storage falls back to the default workspace, which
					// only matters for relay tests — they assert on it explicitly.
				}
			},
			[WORKSPACE_STORAGE_KEY, workspaceId, showGuide ? '' : GUIDE_KEY]
		);
		await use(context);
	}
});

/**
 * Matches the address bar at `path` (a RegExp source, anchored at the end) as the app always
 * leaves it: carrying the workspace's `?ws=`. The address bar is the workspace link — the root
 * layout writes the id back after every navigation — so a bare `/issues` is now the bug, not
 * the expectation. `toHaveURL` retries, which also covers the moment between a client-side
 * navigation landing and the parameter being put back.
 */
export function onRoute(path: string): RegExp {
	return new RegExp(`${path}\\?ws=[A-Za-z0-9_-]+$`);
}

/**
 * Number of Yjs update rows y-indexeddb has committed to the database `DB_NAME`. It never
 * creates the database: counting before the app has opened it would otherwise leave an empty
 * one behind, which y-indexeddb then opens as it is and can store nothing in.
 */
export function committedUpdates(page: Page, DB_NAME: string): Promise<number> {
	return page.evaluate(
		(db) =>
			new Promise<number>((resolve) => {
				const request = indexedDB.open(db);
				// Fires only when there is no such database yet: aborting fails the open (0).
				request.onupgradeneeded = () => request.transaction?.abort();
				request.onsuccess = () => {
					const conn = request.result;
					if (!conn.objectStoreNames.contains('updates')) {
						conn.close();
						resolve(0);
						return;
					}
					const countReq = conn.transaction('updates').objectStore('updates').count();
					countReq.onsuccess = () => {
						conn.close();
						resolve(countReq.result);
					};
					countReq.onerror = () => {
						conn.close();
						resolve(0);
					};
				};
				request.onerror = () => resolve(0);
			}),
		DB_NAME
	);
}

/**
 * Waits until y-indexeddb has committed at least one update beyond `baseline`, and fails the
 * test if it never does. Reloading without this races the async IndexedDB write, and the race
 * is lost, not merely late: a navigation that lands first aborts the transaction, and the
 * reloaded page never had the write. Take the baseline right before the write you care about,
 * once the page shows it has loaded from IndexedDB (its empty state or its list): before
 * that, the load's own first row is not counted yet and would satisfy the wait, and a stale
 * baseline is already satisfied by an earlier mutation.
 *
 * `expect.poll`, not `page.waitForFunction`: handed a predicate that returns a promise,
 * waitForFunction resolves after one call with whatever the promise settles to, `false`
 * included, so it neither waits nor fails.
 */
export async function waitForCommitAbove(page: Page, DB_NAME: string, baseline: number) {
	await expect
		.poll(() => committedUpdates(page, DB_NAME), {
			message: 'the write is committed to IndexedDB'
		})
		.toBeGreaterThan(baseline);
}

export { expect };
export type { Browser, BrowserContext, Page } from '@playwright/test';
