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
