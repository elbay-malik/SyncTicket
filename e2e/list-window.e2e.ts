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

// A row can be in view of the list and still below the fold of `<main>`, which scrolls as well on a
// screen this short. Focus is the cursor, so a cursor nobody can see is no cursor at all.
for (const viewport of [
	{ width: 320, height: 256 },
	{ width: 844, height: 390 },
	{ width: 1280, height: 400 }
]) {
	test(`keeps the cursor on screen at ${viewport.width}x${viewport.height}`, async ({
		page,
		workspaceId
	}) => {
		await page.setViewportSize(viewport);
		await openPlanted(page, workspaceId);
		const cursor = page.locator('[data-issue-link]:focus');

		for (const expected of [0, 1, 2, 3, 4, 5]) {
			await page.keyboard.press('j');
			await expect(cursor).toHaveText(new RegExp(`Planted ${expected}\\b`));
			await expect(cursor).toBeInViewport({ ratio: 1 });
		}

		// Far enough down that the list has to move as well, at the pace a held key repeats.
		const hold = async (key: string, presses: number) => {
			for (let press = 0; press < presses; press += 1) {
				await page.keyboard.press(key);
				await page.waitForTimeout(25);
			}
		};
		await hold('j', 30);
		await expect(cursor).toHaveText(/Planted 35\b/);
		await expect(cursor).toBeInViewport({ ratio: 1 });
		expect(await rows(page).count()).toBeLessThan(60);

		await hold('k', 35);
		await expect(cursor).toHaveText(/Planted 0\b/);
		await expect(cursor).toBeInViewport({ ratio: 1 });
	});
}

// The window's scroll position is the only one SvelteKit keeps, and on this shell the window never
// moves: the list scrolls itself, inside `<main>`. So keeping these is left to the routes.
const firstVisibleRow = (page: Page) =>
	page.evaluate(() => {
		const list = document.querySelector('[data-testid="issue-list"]');
		if (!list) return NaN;
		const top = list.getBoundingClientRect().top;
		const links = [...list.querySelectorAll<HTMLElement>('[data-issue-link]')]
			.filter((link) => link.getBoundingClientRect().bottom > top)
			.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
		return Number(links[0]?.textContent?.match(/Planted (\d+)/)?.[1]);
	});

async function scrollListTo(page: Page, row: number): Promise<number> {
	// Set again on each try: a list just brought back is still settling, and its last correction can
	// land on top of a scroll made in the same few milliseconds, which no hand is quick enough for.
	await expect
		.poll(async () => {
			await scroller(page).evaluate((list, target) => {
				list.scrollTop = target;
			}, row * 41);
			return firstVisibleRow(page);
		})
		.toBeGreaterThan(row - 8);
	await page.waitForTimeout(200);
	return firstVisibleRow(page);
}

test('Back returns the list to the row it was on, and a new visit starts at the top', async ({
	page,
	workspaceId
}) => {
	await openPlanted(page, workspaceId);
	const before = await scrollListTo(page, 144);

	await page.getByRole('link', { name: 'Board', exact: true }).click();
	await expect(page.getByTestId('board-columns')).toBeVisible();
	await page.goBack();

	await expect(page.getByRole('link', { name: `Planted ${before}`, exact: true })).toBeVisible();
	await expect.poll(() => firstVisibleRow(page)).toBe(before);
	expect(await rows(page).count()).toBeLessThan(60);

	// And it survives the trip again, after moving somewhere else.
	const further = await scrollListTo(page, 250);
	expect(further).not.toBe(before);
	await page.goForward();
	await expect(page.getByTestId('board-columns')).toBeVisible();
	await page.goBack();
	await expect.poll(() => firstVisibleRow(page)).toBe(further);

	// A reload keeps it too, though the rows are still coming out of IndexedDB when it is asked for.
	await page.reload();
	await expect.poll(() => firstVisibleRow(page), { timeout: 10_000 }).toBe(further);

	// Clicking through to the list is not going back to it.
	await page.getByRole('link', { name: 'Board', exact: true }).click();
	await expect(page.getByTestId('board-columns')).toBeVisible();
	await page.getByRole('link', { name: 'Issues', exact: true }).click();
	await expect(page.getByRole('link', { name: 'Planted 0', exact: true })).toBeVisible();
	expect(await scroller(page).evaluate((list) => list.scrollTop)).toBe(0);
});

test('Back finds the row it was on even if the rows above it have changed', async ({
	page,
	workspaceId
}) => {
	await openPlanted(page, workspaceId);
	const before = await scrollListTo(page, 144);

	await page.getByRole('link', { name: 'Board', exact: true }).click();
	await expect(page.getByTestId('board-columns')).toBeVisible();
	const doc = new Y.Doc();
	const provider = new YProvider(RELAY_HOST, workspaceId, doc, { party: RELAY_PARTY });
	await new Promise<void>((resolve) => {
		provider.once('synced', () => resolve());
	});
	const issues = doc.getMap<unknown>('issues');
	doc.transact(() => {
		for (let index = 0; index < 50; index += 1) {
			const yIssue = new Y.Map<unknown>();
			issues.set(crypto.randomUUID(), yIssue);
			yIssue.set('title', `Earlier ${index}`);
			yIssue.set('status', 'todo');
			yIssue.set('priority', 'none');
			yIssue.set('order', `a00000${String(index).padStart(2, '0')}1`);
		}
	});
	await expect(page.getByTestId('board-columns').getByText('Earlier 0')).toBeVisible({
		timeout: 10_000
	});
	provider.destroy();
	doc.destroy();

	await page.goBack();
	await expect.poll(() => firstVisibleRow(page)).toBe(before);
});

test('the restored spot on a short screen is on screen', async ({ page, workspaceId }) => {
	await page.setViewportSize({ width: 1280, height: 400 });
	await openPlanted(page, workspaceId);
	const before = await scrollListTo(page, 144);
	const main = page.locator('#main-content');
	await main.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	const mainBefore = await main.evaluate((element) => element.scrollTop);
	expect(mainBefore).toBeGreaterThan(0);

	await page.getByRole('link', { name: 'Board', exact: true }).click();
	await expect(page.getByTestId('board-columns')).toBeVisible();
	await page.goBack();

	await expect.poll(() => firstVisibleRow(page)).toBe(before);
	await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBe(mainBefore);
});

test('the keys that scroll a page scroll the list while focus is on the page', async ({
	page,
	workspaceId
}) => {
	await openPlanted(page, workspaceId);
	const list = scroller(page);
	const scrollTop = () => list.evaluate((element) => element.scrollTop);
	const viewport = await list.evaluate((element) => element.clientHeight);

	// Skip to content, which is what leaves focus on <main> rather than in the list.
	await page.keyboard.press('Tab');
	await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
	await page.keyboard.press('Enter');
	const main = page.locator('#main-content');
	await expect(main).toBeFocused();

	await page.keyboard.press('PageDown');
	await expect.poll(scrollTop).toBeGreaterThan(viewport / 2);
	const afterPage = await scrollTop();
	expect(afterPage).toBeLessThan(viewport);
	await page.keyboard.press('PageUp');
	await expect.poll(scrollTop).toBeLessThan(afterPage);

	await page.keyboard.press('ArrowDown');
	const afterArrow = await scrollTop();
	await page.keyboard.press('ArrowDown');
	await expect.poll(scrollTop).toBeGreaterThan(afterArrow);

	await page.keyboard.press('Space');
	await expect.poll(scrollTop).toBeGreaterThan(viewport / 2);
	await page.keyboard.press('Shift+Space');
	await expect.poll(scrollTop).toBeLessThan(viewport / 2);

	await page.keyboard.press('End');
	await expect(page.getByRole('link', { name: `Planted ${COUNT - 1}`, exact: true })).toBeVisible();
	await page.keyboard.press('Home');
	await expect(page.getByRole('link', { name: 'Planted 0', exact: true })).toBeVisible();
	expect(await scrollTop()).toBe(0);

	// All of it without taking focus from where the skip link put it, and j still means the cursor.
	await expect(main).toBeFocused();
	await page.keyboard.press('j');
	await expect(page.locator('[data-issue-link]:focus')).toHaveText(/Planted 0\b/);
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
