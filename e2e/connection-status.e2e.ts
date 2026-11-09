// What the connection status says, and how fast it recovers, against a real relay.
//
// Two problems from the demo test. A short network blip took about ten seconds to recover
// from, however soon the network came back, and the tab then said "no one else here yet" for
// four seconds more while its peer was there. And a relay that was down or blocked on a
// working network was reported as "you're offline", Share said a plain "Copied", and an
// invitee was offered example issues that later merged into the real workspace.

import { expect, test, type Browser, type BrowserContext, type Page } from './fixtures.js';
import { WORKSPACE_STORAGE_KEY } from '../src/lib/model/workspace.js';

const room = () => `t${crypto.randomUUID().replace(/-/g, '')}`;

async function openPeer(browser: Browser, workspaceId: string): Promise<Page> {
	const context = await browser.newContext();
	await context.addInitScript(
		([key, id]) => window.localStorage.setItem(key as string, id as string),
		[WORKSPACE_STORAGE_KEY, workspaceId]
	);
	const page = await context.newPage();
	await page.goto('/issues');
	await expect(page.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 30_000
	});
	return page;
}

for (const people of [2, 3]) {
	test(`a two-second network blip recovers in a few seconds with ${people} people, and the others show again at once`, async ({
		browser
	}) => {
		const workspaceId = room();
		const pages = await Promise.all(
			Array.from({ length: people }, () => openPeer(browser, workspaceId))
		);
		const [alice, ...others] = pages as [Page, ...Page[]];
		const company = new RegExp(
			people === 2 ? 'Shared with 1 other' : `Shared with ${people - 1} others`
		);
		for (const page of pages) {
			await expect(page.getByTestId('relay-status')).toHaveAttribute('aria-label', company);
		}

		const context = alice.context();
		await context.setOffline(true);
		await expect(alice.getByTestId('relay-status')).toHaveAttribute('data-connection', 'offline', {
			timeout: 1_000
		});
		const input = alice.getByPlaceholder('Add an issue…');
		await input.fill('Written during a blip');
		await input.press('Enter');
		await alice.waitForTimeout(2_000);
		await context.setOffline(false);

		// Before the fix the edit arrived about ten seconds after going offline (up to a minute
		// with three people), and Alice's badge read "no one else here yet" for four seconds
		// after that.
		for (const page of others) {
			await expect(page.getByRole('link', { name: 'Written during a blip' })).toBeVisible({
				timeout: 4_000
			});
		}
		await expect(alice.getByTestId('relay-status')).toHaveAttribute('aria-label', company, {
			timeout: 4_000
		});

		await Promise.all(pages.map((page) => page.context().close()));
	});
}

/** A context whose page loads normally but whose relay connection is refused. */
async function blockedContext(browser: Browser): Promise<BrowserContext> {
	const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
	await context.routeWebSocket(/\/parties\//, (ws) => ws.close());
	return context;
}

test("a blocked relay on a working network says the server can't be reached, not that you're offline", async ({
	browser
}) => {
	const context = await blockedContext(browser);
	const page = await context.newPage();
	await page.goto('/issues');
	const status = page.getByTestId('relay-status');
	await expect(status).toHaveAttribute('data-connection', 'offline', { timeout: 10_000 });

	await expect(status).toHaveAttribute('aria-label', /can't reach the sync server/);
	await expect(status).not.toHaveAttribute('aria-label', /you're offline/);
	await expect(status).toContainText('Server unreachable');
	await expect(
		page.getByRole('status').filter({ hasText: "Can't reach the sync server" })
	).toHaveCount(1);

	// The page itself going offline still says so.
	await context.setOffline(true);
	await expect(status).toHaveAttribute('aria-label', /you're offline/);
	await expect(status).toContainText('Offline');

	await context.close();
});

test('Share warns that the link will not carry the workspace while the relay is unreachable', async ({
	browser
}) => {
	const context = await blockedContext(browser);
	const page = await context.newPage();
	await page.goto('/issues');
	await expect(page.getByTestId('relay-status')).toHaveAttribute('data-connection', 'offline', {
		timeout: 10_000
	});

	await page.getByTestId('share-workspace').click();
	await expect(page.getByTestId('share-workspace')).toContainText('Copied');
	const note = page.getByTestId('share-unsynced');
	await expect(note).toBeVisible();
	await expect(note).toContainText("can't reach the sync server");
	// The copy still happened.
	const copied = await page.evaluate(() => navigator.clipboard.readText());
	expect(copied).toContain('ws=');

	await page.keyboard.press('Escape');
	await expect(note).toBeHidden();
	await context.close();
});

test('an invitee whose relay is blocked is not offered example issues to merge into the real workspace', async ({
	browser
}) => {
	const context = await blockedContext(browser);
	const page = await context.newPage();
	await page.goto(`/issues?ws=${room()}`);
	await expect(page.getByTestId('relay-status')).toHaveAttribute('data-connection', 'offline', {
		timeout: 10_000
	});

	await expect(page.getByTestId('issues-relay-unreachable')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Load example issues' })).toHaveCount(0);
	await context.close();
});

test('an invitee is not offered examples when their own network drops either', async ({
	browser
}) => {
	const context = await blockedContext(browser);
	const page = await context.newPage();
	await page.goto(`/issues?ws=${room()}`);
	await expect(page.getByTestId('issues-relay-unreachable')).toBeVisible({ timeout: 10_000 });
	await context.setOffline(true);
	await expect(page.getByTestId('issues-awaiting-network')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Load example issues' })).toHaveCount(0);
	await context.close();
});

test('a workspace this browser just started still offers examples with the relay blocked', async ({
	browser
}) => {
	// Nobody can have shared anything into a workspace minted a moment ago, so there is
	// nothing to wait for and the empty state is the truth.
	const context = await blockedContext(browser);
	const page = await context.newPage();
	await page.goto('/issues');
	await expect(page.getByTestId('relay-status')).toHaveAttribute('data-connection', 'offline', {
		timeout: 10_000
	});
	await expect(
		page.getByRole('main').getByRole('button', { name: 'Load example issues' })
	).toBeVisible();
	await expect(page.getByTestId('issues-relay-unreachable')).toHaveCount(0);
	await context.close();
});

test('Share says you are offline, not that the server is unreachable, when the network is gone', async ({
	browser
}) => {
	const context = await blockedContext(browser);
	const page = await context.newPage();
	await page.goto('/issues');
	await expect(page.getByTestId('relay-status')).toHaveAttribute('data-connection', 'offline', {
		timeout: 10_000
	});
	await context.setOffline(true);
	await page.getByTestId('share-workspace').click();
	const note = page.getByTestId('share-unsynced');
	await expect(note).toContainText("you're offline");
	await expect(note).not.toContainText('sync server');
	await context.close();
});

test('the network coming back shows connecting, not an unreachable server', async ({ browser }) => {
	const page = await openPeer(browser, room());
	const status = page.getByTestId('relay-status');
	const context = page.context();
	await context.setOffline(true);
	await expect(status).toHaveAttribute('data-connection', 'offline', { timeout: 1_000 });
	const seen: string[] = [];
	await page.exposeFunction('recordLabel', (label: string) => seen.push(label));
	await page.evaluate(() => {
		const el = document.querySelector('[data-testid="relay-status"]') as HTMLElement;
		const record = (window as unknown as { recordLabel(label: string): void }).recordLabel;
		new MutationObserver(() => record(el.getAttribute('aria-label') ?? '')).observe(el, {
			attributes: true,
			attributeFilter: ['aria-label']
		});
	});
	await context.setOffline(false);
	await expect(status).toHaveAttribute('data-synced', 'true', { timeout: 4_000 });
	expect(seen.length).toBeGreaterThan(0);
	expect(seen.filter((label) => /sync server/.test(label))).toEqual([]);
	await context.close();
});
