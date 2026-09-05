// Phase 8 acceptance: search is local. The two halves of the criterion are proven
// separately — that a query issues no network request at all, and that lexical results are
// there before (and without) the language model.

import { expect, test, type Page } from '@playwright/test';

const ISSUES = [
	{ title: 'Palette keeps stale highlight', description: 'focus is stranded after closing' },
	{ title: 'Board column drag is broken', description: 'the handle is unreachable by keyboard' },
	{ title: 'Sync indicator lies', description: 'it shows connected while offline' }
];

/**
 * Seeds through the create dialog rather than the quick-add field, because quick-add sets
 * only a title and these tests are largely about matching on the description.
 */
async function seeded(page: Page) {
	await page.goto('/issues');
	await expect(page.getByText('No issues yet')).toBeVisible();
	for (const issue of ISSUES) {
		await page.keyboard.press('c');
		const dialog = page.getByRole('dialog', { name: 'New issue' });
		await expect(dialog).toBeVisible();
		await dialog.getByLabel('Title').fill(issue.title);
		await dialog.getByLabel('Description').fill(issue.description);
		await page.keyboard.press('ControlOrMeta+Enter');
		await expect(dialog).toBeHidden();
		await expect(page.getByRole('link', { name: issue.title })).toBeVisible();
	}
}

async function openPalette(page: Page) {
	await page.keyboard.press('ControlOrMeta+k');
	const box = page.getByPlaceholder('Search issues or run a command…');
	await expect(box).toBeVisible();
	return box;
}

/** The issue rows in the palette, in rank order. */
const hits = (page: Page) => page.locator('[data-slot="command-item"][data-value^="issue:"]');

test('the palette finds issues by title and by description', async ({ page }) => {
	await seeded(page);
	const box = await openPalette(page);

	await box.fill('palette');
	await expect(hits(page)).toHaveCount(1);
	await expect(hits(page).first()).toContainText('Palette keeps stale highlight');

	// A word that appears only in the description. bits-ui would have filtered this away by
	// scoring it against the title, which is why the palette does its own filtering.
	await box.fill('unreachable');
	await expect(hits(page)).toHaveCount(1);
	await expect(hits(page).first()).toContainText('Board column drag is broken');

	// A query whose words are split across title and description — the case that fails if
	// the two fields are indexed separately.
	await box.fill('sync offline');
	await expect(hits(page)).toHaveCount(1);
	await expect(hits(page).first()).toContainText('Sync indicator lies');
});

test('Enter opens the top result rather than a command', async ({ page }) => {
	await seeded(page);
	const box = await openPalette(page);

	// "board" matches an issue and also the "Go to board" command; the issue is ranked first
	// and the selection has to follow the results, which arrive a round trip late.
	await box.fill('board');
	await expect(hits(page)).toHaveCount(1);
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/\/issues\/[0-9a-f-]{36}$/);
	await expect(page.getByRole('dialog').getByLabel('Title')).toHaveValue(
		'Board column drag is broken'
	);
});

test('commands still filter and run, with search sharing the box', async ({ page }) => {
	await seeded(page);
	const box = await openPalette(page);

	await box.fill('theme');
	await expect(page.getByRole('option', { name: /Light theme/ })).toBeVisible();
	// Commands unrelated to the query are filtered out, as before search existed.
	await expect(page.getByRole('option', { name: /New issue/ })).toHaveCount(0);
});

test('a query makes no network request of any kind', async ({ page }) => {
	await seeded(page);

	// Everything the app needs is already loaded; from here, watch every request.
	const requests: string[] = [];
	page.on('request', (request) => requests.push(request.url()));

	const box = await openPalette(page);
	for (const term of ['palette', 'board', 'sync', 'unreachable', 'stale']) {
		await box.fill(term);
		await expect(hits(page)).not.toHaveCount(0);
	}
	await page.waitForTimeout(500);

	expect(requests, `unexpected requests: ${requests.join(', ')}`).toEqual([]);
});

test('search works with the network off', async ({ page, context }) => {
	await seeded(page);
	// Open once while online so the palette's own work is done; the worker itself is started
	// at app load, which is what makes this possible at all.
	await openPalette(page);
	await page.keyboard.press('Escape');

	await context.setOffline(true);
	const box = await openPalette(page);
	await box.fill('sync');
	await expect(hits(page)).toHaveCount(1);
	await expect(hits(page).first()).toContainText('Sync indicator lies');

	// And the mode is reported honestly: words only, no model involved.
	await expect(page.getByTestId('search-mode')).toContainText('Searching words');
});

test('the index follows edits and deletions', async ({ page }) => {
	await seeded(page);

	// Rename an issue, then search for the new title and the old one.
	await page.getByRole('link', { name: 'Sync indicator lies' }).click();
	const sheet = page.getByRole('dialog');
	await sheet.getByLabel('Title').fill('Connection badge is wrong');
	await sheet.getByLabel('Title').press('Enter');
	await page.keyboard.press('Escape');
	await expect(page).toHaveURL(/\/issues$/);

	const box = await openPalette(page);
	await box.fill('connection');
	await expect(hits(page)).toHaveCount(1);
	await box.fill('indicator');
	await expect(hits(page)).toHaveCount(0);
});
