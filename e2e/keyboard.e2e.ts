// Phase 7 acceptance: every core flow without touching the mouse.
//
// Not a single click in this file. Waiting for the empty state before typing is the repo's
// convention and matters doubly here: shortcuts are registered on mount, so they simply do
// not exist until the client has hydrated.

import { expect, onRoute, test, type Page } from './fixtures.js';

async function seeded(page: Page, titles: string[]) {
	await page.goto('/issues');
	await expect(page.getByText('No issues yet')).toBeVisible();
	for (const title of titles) {
		const input = page.getByPlaceholder('Add an issue…');
		await input.fill(title);
		await input.press('Enter');
		await expect(page.getByRole('link', { name: title })).toBeVisible();
	}
	// Leave the quick-add field: single-letter shortcuts are inert while typing, by design.
	await page.keyboard.press('Escape');
}

const list = (page: Page) => page.locator('[data-testid="issue-list"]');

test('an issue can be created, found, opened, edited and deleted by keyboard alone', async ({
	page
}) => {
	await page.goto('/issues');
	await expect(page.getByText('No issues yet')).toBeVisible();

	// CREATE — "c" opens the dialog from anywhere.
	await page.keyboard.press('c');
	const dialog = page.getByRole('dialog', { name: 'New issue' });
	await expect(dialog).toBeVisible();
	await dialog.getByLabel('Title').fill('Keyboard only');
	await page.keyboard.press('ControlOrMeta+Enter');
	await expect(dialog).toBeHidden();
	await expect(page.getByRole('link', { name: 'Keyboard only' })).toBeVisible();

	// FIND — the cursor moves with j, and moving it moves real focus, which is what makes a
	// screen reader announce the row.
	await page.keyboard.press('j');
	await expect(page.getByRole('link', { name: 'Keyboard only' })).toBeFocused();

	// OPEN — Enter activates the focused link; no global Enter shortcut is involved.
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(onRoute('/issues/[0-9a-f-]{36}'));
	const sheet = page.getByRole('dialog');
	await expect(sheet.getByLabel('Title')).toHaveValue('Keyboard only');
	// The sheet's focus scope puts focus on Title itself, from a requestAnimationFrame, in the
	// frame that first draws it. Everything below can fit inside that one frame, so the
	// autofocus can land between focusing Delete and pressing Enter, and Enter then goes to
	// Title. No person can act that early, since the sheet is not on screen yet. `toBeFocused`
	// cannot wait for it: the focus trap has already put focus on Title by then, when SvelteKit
	// resets focus after the navigation. A frame requested now runs after the scope's.
	await page.evaluate(() => new Promise(requestAnimationFrame));

	// EDIT — Enter commits the field in place.
	await sheet.getByLabel('Title').fill('Renamed by keyboard');
	await page.keyboard.press('Enter');

	// DELETE — the confirmation deliberately opens with focus on the least destructive
	// action, so reaching the destructive one is a Tab away. Asserting that focus has landed
	// before moving is what makes this deterministic: the dialog claims focus itself, one
	// frame after opening, and would otherwise steal it back mid-test.
	await sheet.getByRole('button', { name: 'Delete' }).focus();
	await page.keyboard.press('Enter');
	const confirm = page.getByRole('alertdialog');
	await expect(confirm).toBeVisible();
	await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(confirm.getByRole('button', { name: 'Delete issue' })).toBeFocused();
	await page.keyboard.press('Enter');

	await expect(page).toHaveURL(onRoute('/issues'));
	await expect(page.getByText('No issues yet')).toBeVisible();
});

test('the list cursor walks with j/k and arrows, and stops at the ends', async ({ page }) => {
	// `seeded` quick-adds, and quick-add now leaves the cursor on the issue it just created
	// (see issues.e2e.ts): the row is scrolled to, flashed and marked aria-current, so that the
	// one interaction that could prove "instant by construction" is visible. The cursor
	// therefore starts at the LAST seeded issue rather than nowhere, which is why this walks
	// upward first. The property under test is unchanged — the cursor moves one row per press
	// and clamps at both ends.
	await seeded(page, ['First', 'Second', 'Third']);

	await page.keyboard.press('k');
	await expect(page.getByRole('link', { name: 'Second' })).toBeFocused();
	await page.keyboard.press('k');
	await expect(page.getByRole('link', { name: 'First' })).toBeFocused();
	// Clamped at the top: another press cannot walk off the start of the list.
	await page.keyboard.press('k');
	await expect(page.getByRole('link', { name: 'First' })).toBeFocused();

	await page.keyboard.press('j');
	await expect(page.getByRole('link', { name: 'Second' })).toBeFocused();

	// Arrows work once focus is inside the list, where they cannot suppress page scrolling.
	await page.keyboard.press('ArrowDown');
	await expect(page.getByRole('link', { name: 'Third' })).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(page.getByRole('link', { name: 'Third' })).toBeFocused();
});

test('one Tab enters the list at the cursor rather than walking every row', async ({ page }) => {
	await seeded(page, ['First', 'Second']);
	// Roving tabindex: exactly one row is tabbable at a time.
	await expect(list(page).locator('a[tabindex="0"]')).toHaveCount(1);
	await page.keyboard.press('j');
	await page.keyboard.press('j');
	await expect(page.getByRole('link', { name: 'Second' })).toBeFocused();
	await expect(list(page).locator('a[tabindex="0"]')).toHaveCount(1);
});

test('the palette toggles with the same chord and runs a command', async ({ page }) => {
	await seeded(page, ['Something']);
	const palette = page.getByPlaceholder('Search issues or run a command…');

	await page.keyboard.press('ControlOrMeta+k');
	await expect(palette).toBeVisible();
	// Closing needs the shortcut to survive its own dialog and its own combobox input.
	await page.keyboard.press('ControlOrMeta+k');
	await expect(palette).toBeHidden();

	await page.keyboard.press('ControlOrMeta+k');
	await expect(palette).toBeVisible();
	await palette.fill('board');
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(onRoute('/board'));
});

test('navigation and help are one keystroke away', async ({ page }) => {
	await seeded(page, ['Anything']);

	await page.keyboard.press('b');
	await expect(page).toHaveURL(onRoute('/board'));
	await page.keyboard.press('i');
	await expect(page).toHaveURL(onRoute('/issues'));

	// "?" is matched as the character the keyboard produces, not as Shift plus a US key.
	await page.keyboard.press('?');
	const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
	await expect(help).toBeVisible();
	// The sheet is generated from the registry, so it cannot drift from what actually works.
	await expect(help.getByText('New issue')).toBeVisible();
	await expect(help.getByText('Go to board')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(help).toBeHidden();
});

test('shortcuts stay out of the way while typing', async ({ page }) => {
	await page.goto('/issues');
	await expect(page.getByText('No issues yet')).toBeVisible();

	// Typing a title containing every shortcut letter must not trigger any of them.
	const input = page.getByPlaceholder('Add an issue…');
	await input.fill('cijkb?');
	await expect(page).toHaveURL(onRoute('/issues'));
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(input).toHaveValue('cijkb?');
});
