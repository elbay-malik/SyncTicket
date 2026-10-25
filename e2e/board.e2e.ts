// Phase 5 acceptance: drag within and between columns, persisted through the CRDT and safe
// offline.
//
// The drags here are driven by the keyboard, not the mouse. That is not a shortcut: the
// library detects pointer drop zones on a 200 ms polling timer and animates the drop before
// reporting it, so a synthetic mouse drag is a timing bet. The keyboard path is exact, and
// it doubles as the accessibility proof — the assertions on the live region below are the
// same text a screen-reader user hears.

import { expect, onRoute, test, type Page } from './fixtures.js';

function committedUpdates(page: Page, DB_NAME: string): Promise<number> {
	return page.evaluate(
		(db) =>
			new Promise<number>((resolve) => {
				const request = indexedDB.open(db);
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

async function waitForCommitAbove(page: Page, DB_NAME: string, baseline: number) {
	await page.waitForFunction(
		({ db, base }) =>
			new Promise<boolean>((resolve) => {
				const request = indexedDB.open(db);
				request.onsuccess = () => {
					const conn = request.result;
					if (!conn.objectStoreNames.contains('updates')) {
						conn.close();
						resolve(false);
						return;
					}
					const countReq = conn.transaction('updates').objectStore('updates').count();
					countReq.onsuccess = () => {
						conn.close();
						resolve(countReq.result > base);
					};
					countReq.onerror = () => {
						conn.close();
						resolve(false);
					};
				};
				request.onerror = () => resolve(false);
			}),
		{ db: DB_NAME, base: baseline }
	);
}

/**
 * Seeds issues through the quick-add field, then opens the board.
 *
 * Reaching the board through the sidebar link is deliberate: a `page.goto` would reload the
 * document and rebuild the store from IndexedDB, racing the writes just made in memory.
 * Client-side navigation keeps the same store, and the reload assertions in each test cover
 * hydration explicitly.
 */
async function seed(page: Page, titles: string[]) {
	await page.goto('/issues');
	await expect(page.getByText('No issues yet')).toBeVisible();
	for (const title of titles) {
		const input = page.getByPlaceholder('Add an issue and press Enter…');
		await input.fill(title);
		await input.press('Enter');
		await expect(page.getByRole('link', { name: title })).toBeVisible();
	}
	await page.getByRole('link', { name: 'Board' }).click();
	await expect(page).toHaveURL(onRoute('/board'));
	await expect(page.getByRole('list', { name: 'Backlog' })).toBeVisible();
}

const column = (page: Page, name: string) => page.getByRole('list', { name });

test('a card moves between columns with the keyboard and survives a reload', async ({
	page,
	workspaceDb
}) => {
	await seed(page, ['Alpha', 'Bravo']);
	const backlog = column(page, 'Backlog');
	const todo = column(page, 'Todo');
	await expect(backlog.getByRole('listitem')).toHaveCount(2);

	const baseline = await committedUpdates(page, workspaceDb);

	// Space picks the card up. The library announces it through its own live region.
	await backlog.getByRole('listitem').first().focus();
	await page.keyboard.press('Space');
	await expect(page.locator('#dnd-action-aria-alert')).toContainText('Started dragging item Alpha');

	// Tab is the only way to cross columns; arrows reorder within one. Moving rightwards puts
	// the card at the top of the target column.
	await page.keyboard.press('Tab');
	await expect(todo.getByRole('listitem')).toHaveCount(1);
	await page.keyboard.press('Space');

	await expect(todo.getByRole('listitem').first()).toHaveText(/Alpha/);
	await expect(backlog.getByRole('listitem')).toHaveCount(1);
	// Focus stays on the card the user was moving, rather than falling to the top of the page.
	await expect(todo.getByRole('listitem').first()).toBeFocused();

	// The status really changed, not just the rendering.
	await waitForCommitAbove(page, workspaceDb, baseline);
	await page.reload();
	await expect(column(page, 'Todo').getByRole('listitem').first()).toHaveText(/Alpha/);
	await expect(column(page, 'Backlog').getByRole('listitem')).toHaveCount(1);
});

test('reordering within a column persists', async ({ page, workspaceDb }) => {
	await seed(page, ['First', 'Second', 'Third']);
	const backlog = column(page, 'Backlog');
	await expect(backlog.getByRole('listitem')).toHaveCount(3);

	const baseline = await committedUpdates(page, workspaceDb);
	await backlog.getByRole('listitem').first().focus();
	await page.keyboard.press('Space');
	await page.keyboard.press('ArrowDown'); // swaps with the card below
	await page.keyboard.press('Space');

	await expect(backlog.getByRole('listitem').nth(0)).toHaveText(/Second/);
	await expect(backlog.getByRole('listitem').nth(1)).toHaveText(/First/);

	await waitForCommitAbove(page, workspaceDb, baseline);
	await page.reload();
	const reloaded = column(page, 'Backlog');
	await expect(reloaded.getByRole('listitem').nth(0)).toHaveText(/Second/);
	await expect(reloaded.getByRole('listitem').nth(1)).toHaveText(/First/);
});

test('a card can be moved with the network off and still persists', async ({
	page,
	context,
	workspaceDb
}) => {
	await seed(page, ['Offline card']);
	const backlog = column(page, 'Backlog');
	await expect(backlog.getByRole('listitem')).toHaveCount(1);

	const baseline = await committedUpdates(page, workspaceDb);
	await context.setOffline(true);

	await backlog.getByRole('listitem').first().focus();
	await page.keyboard.press('Space');
	await page.keyboard.press('Tab');
	await page.keyboard.press('Space');
	await expect(column(page, 'Todo').getByRole('listitem')).toHaveCount(1);

	// Reloading needs the network; the write above was always local-only.
	await context.setOffline(false);
	await waitForCommitAbove(page, workspaceDb, baseline);
	await page.reload();
	await expect(column(page, 'Todo').getByRole('listitem').first()).toHaveText(/Offline card/);
});

test('a board card opens the detail sheet', async ({ page }) => {
	await seed(page, ['Openable']);
	await column(page, 'Backlog').getByRole('listitem').first().click();
	await expect(page).toHaveURL(onRoute('/issues/[0-9a-f-]{36}'));
	await expect(page.getByRole('dialog').getByLabel('Title')).toHaveValue('Openable');
});

// The board is the one route wider than any viewport: five fixed 288px columns. They are meant
// to scroll as a set inside <main>, never the page. The inset beside the docked sidebar could
// not shrink below a full viewport (sidebar-inset.svelte's min-w-0 says why), so at 1280 the
// document was 1536 wide and the shared header's Share, Undo and theme toggle sat off-screen —
// one click from /issues, on the most common laptop width. Only the docked case reproduces
// it; 390px, where the sidebar is a sheet, is here because evaluators arrive on phones and a
// fix to the shell must not cost them the board's own scroller.
for (const width of [1280, 390]) {
	test(`the seeded board scrolls its columns, not the page, at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto('/issues');
		await expect(page.getByTestId('presence-bar')).toBeVisible();
		await page.getByRole('button', { name: 'Load example issues' }).click();
		await expect(page.getByText('No issues yet')).toBeHidden();

		// Client-side, for the same reason as `seed` above. Below md the sidebar is a sheet.
		if (width < 768) await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
		await page.getByRole('link', { name: 'Board', exact: true }).click();
		await expect(page).toHaveURL(onRoute('/board'));
		await expect(column(page, 'Backlog').getByRole('listitem').first()).toBeVisible();

		const measured = await page.evaluate(() => {
			const strip = document.querySelector<HTMLElement>('[data-testid="board-columns"]')!;
			return {
				document: document.documentElement.scrollWidth,
				viewport: document.documentElement.clientWidth,
				stripOverflows: strip.scrollWidth > strip.clientWidth
			};
		});
		expect(measured.document).toBe(measured.viewport);
		// Not vacuous: the columns still overflow — they just do it in their own scroller.
		expect(measured.stripOverflows).toBe(true);
		// The header control that carries the product's whole claim (share the link, watch it
		// sync) is the first thing a too-wide page pushes off the right edge.
		await expect(page.getByTestId('share-workspace')).toBeInViewport({ ratio: 1 });
	});
}
