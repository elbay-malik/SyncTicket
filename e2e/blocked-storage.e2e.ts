// A browser set to block all site data, with the real setting rather than a stub.
//
// Any read of localStorage throws there, and libraries the root layout imports read it while
// their modules load, so the app never started: a white page with "500 Internal Error", for a
// first visit and for a shared link alike.

import { expect, test } from './fixtures.js';
import { chromium, type BrowserContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const room = () => `t${crypto.randomUUID().replace(/-/g, '')}`;

/** A Chromium profile whose content settings block cookies and all other site data. */
async function blockingBrowser(dir: string, baseURL: string): Promise<BrowserContext> {
	fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });
	fs.writeFileSync(
		path.join(dir, 'Default', 'Preferences'),
		JSON.stringify({ profile: { default_content_setting_values: { cookies: 2 } } })
	);
	return chromium.launchPersistentContext(dir, { baseURL, channel: 'chromium' });
}

test('the app runs, and says it is not saving, when the browser blocks site data', async ({
	baseURL
}, testInfo) => {
	const context = await blockingBrowser(testInfo.outputPath('profile'), baseURL!);
	const page = context.pages()[0] ?? (await context.newPage());
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));

	await page.goto('/issues');
	// The setting really is in force: this is the browser's own answer, not the app's.
	expect(
		await page.evaluate(() => {
			document.cookie = 'probe=1';
			return document.cookie.includes('probe=1');
		})
	).toBe(false);
	await expect(page.getByText('500 Internal Error')).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible();
	await expect(page).toHaveURL(/\/issues\?ws=w[0-9a-f]{32}$/);
	await expect(page.getByTestId('relay-status')).toHaveAttribute('aria-label', /Not saved/, {
		timeout: 10_000
	});

	const input = page.getByPlaceholder('Add an issue…');
	await input.fill('Works without storage');
	await input.press('Enter');
	await expect(page.getByRole('link', { name: 'Works without storage' })).toBeVisible();
	expect(errors.filter((message) => /localStorage|SecurityError/.test(message))).toEqual([]);
	await context.close();
});

test('a shared link opens and syncs in a browser that blocks site data', async ({
	browser,
	baseURL
}, testInfo) => {
	const workspaceId = room();
	const alice = await (await browser.newContext()).newPage();
	await alice.goto(`/issues?ws=${workspaceId}`);
	await expect(alice.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 30_000
	});
	const input = alice.getByPlaceholder('Add an issue…');
	await input.fill('Shared with a careful browser');
	await input.press('Enter');

	const context = await blockingBrowser(testInfo.outputPath('profile'), baseURL!);
	const bob = context.pages()[0] ?? (await context.newPage());
	await bob.goto(`/issues?ws=${workspaceId}`);
	await expect(bob.getByRole('link', { name: 'Shared with a careful browser' })).toBeVisible({
		timeout: 15_000
	});
	await expect(bob).toHaveURL(new RegExp(`ws=${workspaceId}$`));
	await Promise.all([alice.context().close(), context.close()]);
});
