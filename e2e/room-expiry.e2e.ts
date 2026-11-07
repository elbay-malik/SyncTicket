// A room expires when nobody has opened it for its term, against the real relay.
//
// The e2e relay's term is 40 seconds (workers/relay/wrangler.jsonc, env e2e); production's is
// 30 days (workers/relay/src/expiry.ts). Each test here waits it out, so they are slow by design.

import { expect, test, type Browser, type Page } from './fixtures.js';

const TERM_MS = 40_000;
const room = () => `t${crypto.randomUUID().replace(/-/g, '')}`;

async function visit(browser: Browser, workspaceId: string): Promise<Page> {
	const page = await (await browser.newContext()).newPage();
	await page.goto(`/issues?ws=${workspaceId}`);
	await expect(page.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 30_000
	});
	return page;
}

async function write(page: Page, title: string) {
	const input = page.getByPlaceholder('Add an issue…');
	await input.fill(title);
	await input.press('Enter');
	await expect(page.getByRole('link', { name: title })).toBeVisible();
	// Past the relay's save debounce (5 s trailing, 15 s ceiling), so the room has stored it.
	await page.waitForTimeout(7_000);
}

test('a room nobody opens for its term is deleted, and a newcomer finds it empty', async ({
	browser
}) => {
	test.setTimeout(120_000);
	const workspaceId = room();
	const alice = await visit(browser, workspaceId);
	await write(alice, 'Left behind');
	await alice.context().close();

	await new Promise((resolve) => setTimeout(resolve, TERM_MS + 10_000));
	const newcomer = await visit(browser, workspaceId);
	await expect(newcomer.getByText('No issues yet')).toBeVisible();
	await expect(newcomer.getByRole('link', { name: 'Left behind' })).toHaveCount(0);
	await newcomer.context().close();
});

test('a room someone is in outlives its term', async ({ browser }) => {
	test.setTimeout(120_000);
	const workspaceId = room();
	const alice = await visit(browser, workspaceId);
	await write(alice, 'Still here');

	await alice.waitForTimeout(TERM_MS + 10_000);
	const newcomer = await visit(browser, workspaceId);
	await expect(newcomer.getByRole('link', { name: 'Still here' })).toBeVisible({
		timeout: 10_000
	});
	await Promise.all([alice.context().close(), newcomer.context().close()]);
});
