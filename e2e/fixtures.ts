// Every test gets its own workspace.
//
// Before Phase 9 each test was isolated simply because each browser context started with an
// empty IndexedDB. A relay removes that: every context in the run would otherwise join the
// same Durable Object room, inherit issues created by other tests, and inherit them again on
// the next local run, because the room's storage outlives the process. Seeding a unique
// workspace id before any script runs restores isolation for both the database and the room.

import { test as base, expect } from '@playwright/test';
import { WORKSPACE_STORAGE_KEY, workspaceDbName } from '../src/lib/model/workspace.js';

export interface WorkspaceFixtures {
	/** The workspace this test owns. */
	workspaceId: string;
	/** The IndexedDB database backing it. */
	workspaceDb: string;
}

export const test = base.extend<WorkspaceFixtures>({
	// eslint-disable-next-line no-empty-pattern -- Playwright requires the fixture-args slot.
	workspaceId: async ({}, use) => {
		await use(`t${crypto.randomUUID().replace(/-/g, '')}`);
	},
	workspaceDb: async ({ workspaceId }, use) => {
		await use(workspaceDbName(workspaceId));
	},
	context: async ({ context, workspaceId }, use) => {
		await context.addInitScript(
			([key, id]) => {
				try {
					window.localStorage.setItem(key as string, id as string);
				} catch {
					// A context that cannot use storage falls back to the default workspace, which
					// only matters for relay tests — they assert on it explicitly.
				}
			},
			[WORKSPACE_STORAGE_KEY, workspaceId]
		);
		await use(context);
	}
});

export { expect };
export type { Browser, Page } from '@playwright/test';
