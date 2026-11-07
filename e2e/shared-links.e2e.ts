// Opening a workspace link, against a real relay.
//
// Three problems from the demo test. A link damaged on the way (cut short, a character lost,
// upper-cased) opened an empty workspace the relay refuses, said "you're offline" while the
// network was fine, and replaced the visitor's remembered workspace with the dead one. A good
// link from someone else silently became the workspace a bare address opens, with no way back
// in the app. And a shared deep link said "Issue not found" until the relay answered.

import { expect, test, type Browser, type Page } from './fixtures.js';
import { WORKSPACE_STORAGE_KEY } from '../src/lib/model/workspace.js';

const room = () => `t${crypto.randomUUID().replace(/-/g, '')}`;
const exactly = (path: string, workspaceId: string) => new RegExp(`${path}\\?ws=${workspaceId}$`);

/** A browser that has already opened `workspaceId`, synced, with one issue in it. */
async function owner(browser: Browser, workspaceId: string, title: string): Promise<Page> {
	const page = await (await browser.newContext()).newPage();
	await page.goto(`/issues?ws=${workspaceId}`);
	await expect(page.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 30_000
	});
	const input = page.getByPlaceholder('Add an issue…');
	await input.fill(title);
	await input.press('Enter');
	await expect(page.getByRole('link', { name: title })).toBeVisible();
	return page;
}

const remembered = (page: Page) =>
	page.evaluate((key) => localStorage.getItem(key), WORKSPACE_STORAGE_KEY);

for (const [damage, mangle] of [
	['cut short', (id: string) => id.slice(0, 18)],
	['missing its last character', (id: string) => id.slice(0, -1)]
] as const) {
	test(`a link ${damage} says so and keeps the visitor in their own workspace`, async ({
		browser
	}) => {
		const own = room();
		const page = await owner(browser, own, 'My own issue');

		await page.goto(`/issues?ws=${mangle(room())}`);
		await expect(page.getByTestId('invalid-workspace-link')).toBeVisible();
		await expect(page).toHaveURL(exactly('/issues', own));
		await expect(page.getByRole('link', { name: 'My own issue' })).toBeVisible();
		await expect(page.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
			timeout: 10_000
		});
		expect(await remembered(page)).toBe(own);

		// A bare address still opens the visitor's own workspace.
		await page.goto('/issues');
		await expect(page).toHaveURL(exactly('/issues', own));
		await page.context().close();
	});
}

test('an upper-cased link opens the workspace it was copied from', async ({ browser }) => {
	const shared = room();
	const alice = await owner(browser, shared, 'Shared before the copy');
	const bob = await (await browser.newContext()).newPage();
	await bob.goto(`/issues?ws=${shared.toUpperCase()}`);
	await expect(bob).toHaveURL(exactly('/issues', shared));
	await expect(bob.getByRole('link', { name: 'Shared before the copy' })).toBeVisible({
		timeout: 10_000
	});
	await expect(bob.getByTestId('invalid-workspace-link')).toHaveCount(0);
	await Promise.all([alice.context().close(), bob.context().close()]);
});

test("someone's link says where you are, keeps your own workspace, and both ways back work", async ({
	browser
}) => {
	const friend = room();
	const alice = await owner(browser, friend, "Alice's issue");
	const own = room();
	const page = await owner(browser, own, 'My own issue');

	await page.goto(`/issues?ws=${friend}`);
	await expect(page.getByRole('link', { name: "Alice's issue" })).toBeVisible({ timeout: 10_000 });
	const notice = page.getByTestId('joined-workspace');
	await expect(notice).toBeVisible();
	await expect(notice).toContainText('workspace someone shared');
	// The link did not replace the visitor's own workspace.
	expect(await remembered(page)).toBe(own);
	// So links inside it carry the workspace, or an issue opened in a new tab would land in the
	// visitor's own, as "Issue not found".
	await expect(page.getByRole('link', { name: "Alice's issue" })).toHaveAttribute(
		'href',
		new RegExp(`\\?ws=${friend}$`)
	);
	const tab = await page.context().newPage();
	await tab.goto((await page.getByRole('link', { name: "Alice's issue" }).getAttribute('href'))!);
	await expect(tab.getByRole('dialog').getByLabel('Title')).toHaveValue("Alice's issue", {
		timeout: 10_000
	});
	await tab.close();

	await page.getByTestId('joined-workspace-back').click();
	await expect(page).toHaveURL(exactly('/issues', own));
	await expect(page.getByRole('link', { name: 'My own issue' })).toBeVisible();
	// Home again: nothing to say.
	await expect(page.getByTestId('joined-workspace')).toHaveCount(0);
	expect(await remembered(page)).toBe(own);

	// After the notice is gone, the palette still switches between the two.
	await page.keyboard.press('ControlOrMeta+k');
	await page.getByRole('option', { name: 'Switch to your previous workspace' }).click();
	await expect(page).toHaveURL(exactly('/issues', friend));
	await expect(page.getByRole('link', { name: "Alice's issue" })).toBeVisible({ timeout: 10_000 });
	// Opened before, so not new, but still not the visitor's usual workspace.
	await expect(page.getByTestId('joined-workspace')).toContainText("isn't your usual workspace");

	await Promise.all([alice.context().close(), page.context().close()]);
});

test('making a shared workspace yours is what makes a bare address open it', async ({
	browser
}) => {
	const friend = room();
	const alice = await owner(browser, friend, "Alice's issue");
	const page = await owner(browser, room(), 'My own issue');

	await page.goto(`/issues?ws=${friend}`);
	await page.getByTestId('joined-workspace-adopt').click();
	await expect(page.getByTestId('joined-workspace')).toHaveCount(0);
	expect(await remembered(page)).toBe(friend);
	await page.goto('/issues');
	await expect(page).toHaveURL(exactly('/issues', friend));
	await Promise.all([alice.context().close(), page.context().close()]);
});

test('forgetting a workspace removes it from this device and goes to the one before', async ({
	browser
}) => {
	const friend = room();
	const alice = await owner(browser, friend, "Alice's issue");
	const own = room();
	const page = await owner(browser, own, 'My own issue');
	await page.goto(`/issues?ws=${friend}`);
	await expect(page.getByRole('link', { name: "Alice's issue" })).toBeVisible({ timeout: 10_000 });

	// A second tab of the same workspace, which has to stop rather than write on into a deleted
	// database.
	const other = await page.context().newPage();
	await other.goto(`/issues?ws=${friend}`);
	await expect(other.getByRole('link', { name: "Alice's issue" })).toBeVisible({ timeout: 10_000 });

	page.once('dialog', (dialog) => void dialog.accept());
	await page.keyboard.press('ControlOrMeta+k');
	await page.getByRole('option', { name: 'Forget this workspace on this device' }).click();
	await expect(page).toHaveURL(exactly('/issues', own));
	await expect(page.getByRole('link', { name: 'My own issue' })).toBeVisible();
	const databases = await page.evaluate(async () =>
		(await indexedDB.databases()).map((db) => db.name)
	);
	expect(databases).not.toContain(`syncticket:${friend}`);
	expect(databases).toContain(`syncticket:${own}`);
	await expect(other).toHaveURL(exactly('/issues', own));
	// Alice's copy is hers, and untouched.
	await expect(alice.getByRole('link', { name: "Alice's issue" })).toBeVisible();
	await Promise.all([alice.context().close(), page.context().close()]);
});

test('workspace links are kept out of search engines', async ({ request }) => {
	const linked = await request.get(`/issues?ws=${room()}`);
	expect(linked.headers()['x-robots-tag']).toBe('noindex');
	const landing = await request.get('/issues');
	expect(landing.headers()['x-robots-tag']).toBeUndefined();
});

test('a first visit through a link has nothing to go back to and says nothing', async ({
	browser
}) => {
	const shared = room();
	const alice = await owner(browser, shared, 'Shared');
	const bob = await (await browser.newContext()).newPage();
	await bob.goto(`/issues?ws=${shared}`);
	await expect(bob.getByRole('link', { name: 'Shared' })).toBeVisible({ timeout: 10_000 });
	await expect(bob.getByTestId('joined-workspace')).toHaveCount(0);
	await bob.keyboard.press('ControlOrMeta+k');
	await expect(bob.getByRole('option', { name: 'Light theme' })).toBeVisible();
	await expect(bob.getByRole('option', { name: 'Switch to your previous workspace' })).toHaveCount(
		0
	);
	await Promise.all([alice.context().close(), bob.context().close()]);
});

/** Records every time the sheet says "Issue not found", from the first paint on. */
async function watchForNotFound(page: Page) {
	await page.addInitScript(() => {
		const seen: string[] = [];
		(window as unknown as { notFound: string[] }).notFound = seen;
		new MutationObserver(() => {
			if (document.body?.innerText.includes('Issue not found')) seen.push('seen');
		}).observe(document, { childList: true, subtree: true, characterData: true });
	});
}

test('a shared deep link waits for the relay instead of saying the issue was not found', async ({
	browser
}) => {
	const shared = room();
	const alice = await owner(browser, shared, 'Deep linked');
	await alice.getByRole('link', { name: 'Deep linked' }).click();
	await expect(alice).toHaveURL(/\/issues\/[0-9a-f-]{36}\?/);
	const issuePath = new URL(alice.url()).pathname;

	const context = await browser.newContext();
	// Latency like a real relay's, both ways: the not-found state lasted the whole round trip.
	await context.routeWebSocket(/\/parties\//, (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => setTimeout(() => server.send(message), 400));
		server.onMessage((message) => setTimeout(() => ws.send(message), 400));
	});
	const bob = await context.newPage();
	await watchForNotFound(bob);
	await bob.goto(`${issuePath}?ws=${shared}`);
	await expect(bob.getByRole('dialog').getByLabel('Title')).toHaveValue('Deep linked', {
		timeout: 15_000
	});
	expect(await bob.evaluate(() => (window as unknown as { notFound: string[] }).notFound)).toEqual(
		[]
	);
	await Promise.all([alice.context().close(), context.close()]);
});

test('a shared deep link with the relay blocked says it has not loaded, not that it is gone', async ({
	browser
}) => {
	const context = await browser.newContext();
	await context.routeWebSocket(/\/parties\//, (ws) => ws.close());
	const page = await context.newPage();
	await page.goto(`/issues/0b7f3c1e-8d2a-4f6b-9c3e-5a1d2e3f4a5b?ws=${room()}`);
	const unreachable = page.getByTestId('issue-sheet-unreachable');
	await expect(unreachable).toBeVisible({ timeout: 10_000 });
	await expect(unreachable).toContainText("sync server can't be reached");
	await expect(page.getByText('Issue not found')).toHaveCount(0);
	await context.close();
});
