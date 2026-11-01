// The list only renders a window of its rows if something above it has a height. Svelte-level tests
// give it a fixed-height host, so they kept passing while the real page gave it none: the shell
// grew to fit, the scroller grew with it, and every row a link-holder wrote mounted on every load.

import YProvider from 'y-partyserver/provider';
import * as Y from 'yjs';
import { expect, test, type Page } from './fixtures.js';

/** Must match RELAY_PORT in playwright.config.ts and RELAY_PARTY in src/lib/sync/provider.ts. */
const RELAY_HOST = 'localhost:18791';
const RELAY_PARTY = 'y-doc-room';

const COUNT = 401;

async function plantIssues(workspaceId: string): Promise<void> {
	const doc = new Y.Doc();
	const provider = new YProvider(RELAY_HOST, workspaceId, doc, { party: RELAY_PARTY });
	await new Promise<void>((resolve) => {
		provider.once('synced', () => resolve());
	});
	const issues = doc.getMap<unknown>('issues');
	doc.transact(() => {
		for (let index = 0; index < COUNT; index += 1) {
			const yIssue = new Y.Map<unknown>();
			issues.set(crypto.randomUUID(), yIssue);
			yIssue.set('title', `Planted ${index}`);
			yIssue.set('status', 'todo');
			yIssue.set('priority', 'none');
			// A valid key can't end in 0, and an invalid one would sort these in no particular order.
			yIssue.set('order', `a0${String(index).padStart(4, '0')}1`);
		}
	});
	await new Promise((resolve) => setTimeout(resolve, 500));
	provider.destroy();
	doc.destroy();
}

async function openPlanted(page: Page, workspaceId: string): Promise<void> {
	await page.goto('/issues');
	await expect(page.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 30_000
	});
	await plantIssues(workspaceId);
	await expect(page.getByRole('link', { name: 'Planted 0', exact: true })).toBeVisible({
		timeout: 10_000
	});
}

const rows = (page: Page) => page.locator('[data-issue-link]');
const scroller = (page: Page) => page.getByTestId('issue-list');

for (const viewport of [
	{ width: 1280, height: 720 },
	{ width: 390, height: 844 }
]) {
	test(`mounts a window of the rows at ${viewport.width}x${viewport.height}`, async ({
		page,
		workspaceId
	}) => {
		await page.setViewportSize(viewport);
		await openPlanted(page, workspaceId);

		expect(await rows(page).count()).toBeLessThan(60);
		const measured = await scroller(page).evaluate((list) => ({
			scrolls: list.scrollHeight > list.clientHeight,
			fits: list.getBoundingClientRect().bottom <= window.innerHeight,
			documentScrolls: document.documentElement.scrollHeight > window.innerHeight
		}));
		expect(measured).toEqual({ scrolls: true, fits: true, documentScrolls: false });

		// Everything is still there to be reached, by scrolling the list itself.
		await scroller(page).evaluate((list) => {
			list.scrollTop = list.scrollHeight;
		});
		await expect(
			page.getByRole('link', { name: `Planted ${COUNT - 1}`, exact: true })
		).toBeVisible();
		expect(await rows(page).count()).toBeLessThan(60);
	});
}

test('stays usable on a screen too short for it, by scrolling the page around it', async ({
	page,
	workspaceId
}) => {
	// 1280x1024 at 400% zoom (WCAG 1.4.10), where the controls above the list fill the screen.
	await page.setViewportSize({ width: 320, height: 256 });
	await openPlanted(page, workspaceId);

	expect(await rows(page).count()).toBeLessThan(60);
	const list = scroller(page);
	expect((await list.boundingBox())?.height).toBeGreaterThanOrEqual(200);

	await list.scrollIntoViewIfNeeded();
	await expect(page.getByRole('link', { name: 'Planted 0', exact: true })).toBeInViewport();
});

test('leaves the board reachable to its last card on a short screen', async ({
	page,
	workspaceId
}) => {
	await page.setViewportSize({ width: 1280, height: 400 });
	await openPlanted(page, workspaceId);

	await page.getByRole('link', { name: 'Board', exact: true }).click();
	const cards = page.getByTestId('board-columns').getByRole('listitem');
	await expect(cards.first()).toBeVisible();

	const last = cards.last();
	await last.scrollIntoViewIfNeeded();
	await expect(last).toBeInViewport();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
});
