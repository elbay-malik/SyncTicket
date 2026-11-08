import { expect, onRoute, test } from './fixtures.js';

test('root redirects to /issues and renders the shell', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(onRoute('/issues'));
	await expect(page.getByRole('heading', { name: 'Issues' })).toBeVisible();
	await expect(page.getByText('No issues yet')).toBeVisible();
});

test('theme menu switches to dark mode', async ({ page }) => {
	await page.goto('/issues');
	// The empty state only renders once the client has hydrated (see issues.e2e.ts). Clicking
	// the server-rendered toggle before then does nothing — the menu never mounts — and that
	// race lost about one run in twelve under --repeat-each.
	await expect(page.getByText('No issues yet')).toBeVisible();
	await page.getByRole('button', { name: 'Toggle theme' }).click();
	await page.getByRole('menuitem', { name: 'Dark' }).click();
	await expect(page.locator('html')).toHaveClass(/dark/);
});

test('command menu opens with the keyboard shortcut', async ({ page }) => {
	await page.goto('/issues');
	// Retry the shortcut: the document-level listener only exists once Svelte has hydrated.
	await expect(async () => {
		await page.keyboard.press('ControlOrMeta+k');
		await expect(page.getByPlaceholder('Search issues or run a command…')).toBeVisible({
			timeout: 1000
		});
	}).toPass({ timeout: 15_000 });
	await expect(page.getByRole('heading', { name: 'Command Palette' })).toBeAttached();
});

test('the legal pages are linked from every page, on a phone too, without the workspace id', async ({
	page
}) => {
	const imprint = page.getByRole('link', { name: 'Impressum' });
	const privacy = page.getByRole('link', { name: 'Privacy' });

	await page.goto('/issues');
	await expect(imprint).toHaveAttribute('href', 'https://elbaymalik.com/impressum/');
	await expect(imprint).toHaveAttribute('lang', 'de');
	await expect(privacy).toHaveAttribute('href', 'https://elbaymalik.com/datenschutz/');
	await expect(imprint).toBeVisible();

	// The error page renders inside the same layout.
	await page.goto('/no-such-page');
	await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
	await expect(privacy).toBeVisible();

	// On a phone the sidebar is a sheet behind the menu button.
	await page.setViewportSize({ width: 390, height: 740 });
	await page.goto('/board');
	// Drawn on the client only, so wait for the page before saying the links are tucked away.
	await expect(page.getByRole('button', { name: 'Toggle Sidebar' })).toBeVisible();
	await expect(imprint).toBeHidden();
	await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
	await expect(imprint).toBeVisible();
	await expect(privacy).toBeVisible();

	// Following one sends the other site this origin only, not the address with `?ws=`.
	await expect(page).toHaveURL(/[?&]ws=/);
	const origin = new URL(page.url()).origin;
	let referer: string | null = null;
	await page.route('https://elbaymalik.com/**', async (route) => {
		referer = await route.request().headerValue('referer');
		await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>legal</p>' });
	});
	await privacy.click();
	await expect(page.getByText('legal')).toBeVisible();
	expect(referer).toBe(`${origin}/`);
});
