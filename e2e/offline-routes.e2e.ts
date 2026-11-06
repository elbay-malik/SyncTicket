// Every page opens offline, wherever the visit started.
//
// Each route is a lazily imported chunk. Only the detail route used to be fetched ahead, so
// clicking Board for the first time with the network off showed a bare "500 Internal Error",
// and in Chromium it stayed that way after coming back online, because the browser remembers a
// failed import for the life of the page. A visit that started on Board had the same problem
// with Issues. The root layout now fetches every route's code as the app opens.

import { expect, test, type Page } from './fixtures.js';

/** The page has loaded and every chunk it fetches on its own has arrived. */
async function settled(page: Page) {
	await expect(page.getByTestId('relay-status')).toBeVisible();
	await page.waitForLoadState('networkidle');
}

test('Board opens offline when the visit started on Issues', async ({ page, context }) => {
	await page.goto('/issues');
	await expect(page.getByText('No issues yet')).toBeVisible();
	await page.getByPlaceholder('Add an issue…').fill('Made before going offline');
	await page.getByPlaceholder('Add an issue…').press('Enter');
	await settled(page);

	await context.setOffline(true);
	await page.getByRole('link', { name: 'Board', exact: true }).click();

	await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible();
	await expect(page.getByText('Made before going offline')).toBeVisible();
	await expect(page.getByTestId('route-error')).toHaveCount(0);
	await context.setOffline(false);
});

test('Issues and an issue open offline when the visit started on Board', async ({
	page,
	context
}) => {
	// A fresh browser that starts on Board and never touches the Issues page while online, not
	// even through the HTTP cache. The issue is made with the global New issue dialog.
	await page.goto('/board');
	await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible();
	await expect(async () => {
		await page.keyboard.press('c');
		await expect(page.getByRole('dialog', { name: 'New issue' })).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 15_000 });
	const dialog = page.getByRole('dialog', { name: 'New issue' });
	await expect(dialog.getByLabel('Title')).toBeFocused();
	await dialog.getByLabel('Title').fill('Open me offline');
	await dialog.getByRole('button', { name: 'Create issue' }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByText('Open me offline')).toBeVisible();
	await settled(page);

	await context.setOffline(true);
	await page.getByRole('link', { name: 'Issues', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Issues' })).toBeVisible();
	await page
		.getByRole('link', { name: /Open me offline/ })
		.first()
		.click();
	await expect(page.getByRole('dialog').getByLabel('Title')).toHaveValue('Open me offline');
	await expect(page.getByTestId('route-error')).toHaveCount(0);
	await context.setOffline(false);
});

test("a page whose code can't be fetched says so and offers the way back", async ({ page }) => {
	// Stand in for a chunk that is unreachable: the board's page component never arrives.
	await page.route(/\/_app\/immutable\/nodes\/.*\.js$/, async (route) => {
		const body = await (await route.fetch()).text();
		if (body.includes('Drag a card')) return route.abort('internetdisconnected');
		return route.continue();
	});
	await page.goto('/issues');
	await expect(page.getByText('No issues yet')).toBeVisible();

	await page.getByRole('link', { name: 'Board', exact: true }).click();

	const error = page.getByTestId('route-error');
	await expect(error).toBeVisible();
	await expect(error.getByRole('heading', { name: "This page didn't load" })).toBeVisible();
	await expect(page.getByText('Internal Error')).toHaveCount(0);
	await expect(error.getByRole('button', { name: 'Reload' })).toBeEnabled();

	await error.getByRole('link', { name: 'Go to Issues' }).click();
	await expect(page.getByText('No issues yet')).toBeVisible();
});

test('an address that matches nothing gets a real page, inside the app', async ({ page }) => {
	await page.goto('/no-such-page');
	const error = page.getByTestId('route-error');
	await expect(error.getByRole('heading', { name: 'Page not found' })).toBeVisible();
	await expect(page.getByTestId('relay-status')).toBeVisible();

	await error.getByRole('link', { name: 'Go to Issues' }).click();
	await expect(page.getByText('No issues yet')).toBeVisible();
});
