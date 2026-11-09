// The "Try this" card, in the real app: when it appears, the ways out, the way back, and that
// it stays out of the demo's way, at a phone's width too.

import { expect, test } from './fixtures.js';
import { GUIDE_KEY } from '../src/lib/state/guide-key.js';
import { workspaceShareUrl } from '../src/lib/model/workspace.js';

test.use({ showGuide: true });

const card = (page: import('@playwright/test').Page) =>
	page.getByRole('complementary', { name: 'Try this' });

test('appears on a first visit without taking focus, closes for the visit, and comes back on reload', async ({
	page
}) => {
	await page.goto('/issues');
	await expect(card(page)).toBeVisible();
	// The empty workspace's own invitation to load examples, so step one starts there.
	await expect(card(page).getByRole('listitem').first()).toHaveText(
		/See it sync[\s\S]*Load example issues\s*Open a second window\s*$/
	);
	expect(await card(page).evaluate((el) => el.contains(document.activeElement))).toBe(false);

	await card(page).getByRole('button', { name: 'Close', exact: true }).click();
	await expect(card(page)).toBeHidden();
	// Focus does not fall to the top of the page.
	await expect(page.locator('#main-content')).toBeFocused();

	await page.reload();
	await expect(card(page)).toBeVisible();
});

test("Don't show again sticks across reloads; the header button and the palette bring it back", async ({
	page
}) => {
	await page.goto('/issues');
	await card(page).getByRole('button', { name: "Don't show again" }).click();
	await expect(card(page)).toBeHidden();
	expect(await page.evaluate((key) => localStorage.getItem(key), GUIDE_KEY)).toBe('dismissed');

	await page.reload();
	await expect(page.getByPlaceholder('Add an issue…')).toBeVisible();
	await expect(card(page)).toBeHidden();

	await page.getByRole('button', { name: 'Show the guide' }).click();
	await expect(card(page)).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(card(page)).toBeHidden();

	await expect(async () => {
		await page.keyboard.press('ControlOrMeta+k');
		await expect(page.getByPlaceholder('Search issues or run a command…')).toBeVisible({
			timeout: 1000
		});
	}).toPass({ timeout: 15_000 });
	await page.keyboard.type('Show the guide');
	await page.keyboard.press('Enter');
	await expect(card(page)).toBeVisible();
	await expect(card(page)).toBeFocused();
});

test('stays out of a second window opened beside the first, which keeps its own', async ({
	page,
	context,
	workspaceId
}) => {
	await page.goto('/issues');
	await expect(card(page)).toBeVisible();

	// What the card's first step, and the "Open a second window" button, opens.
	const second = await context.newPage();
	await second.goto(workspaceShareUrl('', workspaceId));
	await expect(second.getByPlaceholder('Add an issue…')).toBeVisible();
	// Longer than the window waits for an answer, so a late card would have shown by now.
	await second.waitForTimeout(1000);
	await expect(card(second)).toBeHidden();
	await expect(card(page)).toBeVisible();
	// The way back still works there.
	await second.getByRole('button', { name: 'Show the guide' }).click();
	await expect(card(second)).toBeVisible();
});

test("at 360px it starts as one line that fits the screen and covers none of the page's controls", async ({
	page
}) => {
	await page.setViewportSize({ width: 360, height: 740 });
	await page.goto('/issues');
	await expect(card(page)).toBeVisible();

	const box = (await card(page).boundingBox())!;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(360);
	expect(box.y + box.height).toBeLessThanOrEqual(740);
	// Collapsed to one line, it clears everything above it, the empty state's own button too.
	await expect(card(page).getByRole('button', { name: 'Show', exact: true })).toBeVisible();
	for (const covered of [
		page.getByPlaceholder('Add an issue…'),
		page.locator('header'),
		page.getByRole('main').getByRole('button', { name: 'Load example issues' })
	]) {
		const other = (await covered.boundingBox())!;
		expect(other.y + other.height, 'card overlaps a main control').toBeLessThanOrEqual(box.y);
	}
});
