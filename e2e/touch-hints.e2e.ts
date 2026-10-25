// Key hints on a phone.
//
// The Kbd component hides inline hints on a touch-only device — the "C" on New issue
// advertised a key the visitor does not have, on the screen PRODUCT.md says evaluators most
// often arrive on. The component test proves the generated CSS rule exists and which chips it
// matches; this proves the media query actually matches a phone-shaped browser, which only a
// real `hasTouch` context can say (the pointer and hover features cannot be emulated per page).
//
// And that the shortcuts sheet, which is ABOUT keys, keeps every chip there — and can be
// opened on a phone at all, which has no `?` to press: the sidebar's "Keyboard shortcuts" row
// is a button for exactly that.

import { expect, test } from './fixtures.js';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('inline key hints hide on a touch-only device, and the shortcuts sheet keeps them', async ({
	page
}) => {
	await page.goto('/issues');
	await expect(page.getByTestId('presence-bar')).toBeVisible();

	// The context really is touch-only, or everything below is vacuous.
	expect(await page.evaluate(() => matchMedia('(pointer: coarse) and (hover: none)').matches)).toBe(
		true
	);

	const newIssue = page.getByRole('button', { name: 'New issue' });
	await expect(newIssue).toBeVisible();
	await expect(newIssue.locator('kbd')).toBeHidden();

	// A phone with a Bluetooth keyboard still has the shortcut; the sheet is how it is learnt.
	await page.keyboard.press('?');
	const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
	await expect(help).toBeVisible();
	const chips = help.locator('kbd');
	expect(await chips.count()).toBeGreaterThanOrEqual(8);
	for (const chip of await chips.all()) await expect(chip).toBeVisible();
	await expect(help.getByText("Move across a row's status and priority")).toBeVisible();
});

test('the sidebar opens the shortcuts sheet on a phone, where there is no ? key', async ({
	page
}) => {
	await page.goto('/issues');
	await expect(page.getByTestId('presence-bar')).toBeVisible();

	await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
	const row = page.getByRole('button', { name: 'Keyboard shortcuts' });
	await expect(row).toBeVisible();
	// Its chip hides like every inline hint; the row is a label for an action, not for a key.
	await expect(row.locator('kbd')).toBeHidden();
	await row.click();

	const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
	await expect(help).toBeVisible();
	for (const chip of await help.locator('kbd').all()) await expect(chip).toBeVisible();
});
