// A browser without crypto.randomUUID still runs the app.
//
// Chrome on an iOS 27.3 beta iPhone showed the page for half a second and then went black:
// "Failed to hydrate: TypeError: crypto.randomUUID is not a function". A first visit mints its
// workspace id during hydration, and that call threw. These delete the method before any script
// runs, so the page has to fall back to crypto.getRandomValues.

import { expect, test } from '@playwright/test';

test.describe('a browser without crypto.randomUUID', () => {
	test.beforeEach(async ({ context }) => {
		await context.addInitScript(() => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- deleting a built-in on purpose.
			delete (Crypto.prototype as any).randomUUID;
		});
	});

	test('a first visit gets a workspace and can seed and add issues', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		page.on('console', (message) => {
			if (/hydrate|randomUUID/i.test(message.text())) errors.push(message.text());
		});

		await page.goto('/');
		await expect(page).toHaveURL(/\/issues\?ws=w[0-9a-f]{32}$/);
		expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');

		await page.getByRole('button', { name: 'Load example issues' }).click();
		await expect(page.getByText('Board column drag is broken')).toBeVisible();

		const add = page.getByPlaceholder('Add an issue…');
		await add.fill('Made without randomUUID');
		await add.press('Enter');
		await expect(page.getByText('Made without randomUUID')).toBeVisible();

		expect(errors).toEqual([]);
	});
});
