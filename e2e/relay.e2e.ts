// Phase 9 acceptance: two browsers in the same workspace converge through the relay.
//
// These tests deliberately do not use the per-test workspace fixture the way the others do:
// they need two contexts in the *same* room, so the id is seeded into both by hand.

import { expect, test, type Browser, type Page } from './fixtures.js';
import { WORKSPACE_STORAGE_KEY } from '../src/lib/model/workspace.js';

/** Opens a page already bound to `workspaceId`, and waits until the relay has synced it. */
async function openPeer(browser: Browser, workspaceId: string): Promise<Page> {
	const context = await browser.newContext();
	await context.addInitScript(
		([key, id]) => window.localStorage.setItem(key as string, id as string),
		[WORKSPACE_STORAGE_KEY, workspaceId]
	);
	const page = await context.newPage();
	await page.goto('/issues');
	// The relay indicator is the honest gate: "connected" fires when the socket opens, which
	// is before the two sides have exchanged state, and measuring from there would count a
	// protocol round trip as latency.
	await expect(page.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 30_000
	});
	return page;
}

const room = () => `t${crypto.randomUUID().replace(/-/g, '')}`;

test('an issue created in one browser appears in the other', async ({ browser }) => {
	const workspaceId = room();
	const [alice, bob] = await Promise.all([
		openPeer(browser, workspaceId),
		openPeer(browser, workspaceId)
	]);

	await expect(alice.getByText('No issues yet')).toBeVisible();
	await expect(bob.getByText('No issues yet')).toBeVisible();

	const input = alice.getByPlaceholder('Add an issue and press Enter…');
	await input.fill('Written by Alice');
	await input.press('Enter');

	await expect(bob.getByRole('link', { name: 'Written by Alice' })).toBeVisible({
		timeout: 10_000
	});

	// And the other direction, on the same pair.
	const bobInput = bob.getByPlaceholder('Add an issue and press Enter…');
	await bobInput.fill('Written by Bob');
	await bobInput.press('Enter');
	await expect(alice.getByRole('link', { name: 'Written by Bob' })).toBeVisible({
		timeout: 10_000
	});

	await Promise.all([alice.context().close(), bob.context().close()]);
});

test('a round trip completes well inside a second', async ({ browser }, testInfo) => {
	const workspaceId = room();
	const [alice, bob] = await Promise.all([
		openPeer(browser, workspaceId),
		openPeer(browser, workspaceId)
	]);
	await expect(alice.getByText('No issues yet')).toBeVisible();

	// The acceptance criterion is a sub-second convergence. A single sample on a shared CI
	// runner is a coin flip, so take several and judge the median — the ceiling on each
	// individual wait stays generous so a slow machine fails slowly rather than falsely.
	const samples: number[] = [];
	for (let i = 0; i < 5; i += 1) {
		const title = `Round trip ${i}`;
		const input = alice.getByPlaceholder('Add an issue and press Enter…');
		await input.fill(title);
		const started = Date.now();
		await input.press('Enter');
		await expect(bob.getByRole('link', { name: title })).toBeVisible({ timeout: 10_000 });
		samples.push(Date.now() - started);
	}

	const median = [...samples].sort((a, b) => a - b)[2] as number;
	await testInfo.attach('convergence-ms', { body: JSON.stringify({ samples, median }) });
	expect(median).toBeLessThan(1000);

	await Promise.all([alice.context().close(), bob.context().close()]);
});

test('edits made while cut off from the relay converge once it is reachable', async ({
	browser
}) => {
	const workspaceId = room();
	const bob = await openPeer(browser, workspaceId);

	// Genuinely unreachable, not merely "offline": Playwright's offline mode does not close a
	// socket that is already open, so a test built on it would sync anyway and prove nothing.
	// The handler is switched with a flag rather than removed later — unrouteAll only clears
	// route() and routeFromHAR(), never routeWebSocket().
	let relayReachable = false;
	const aliceContext = await browser.newContext();
	await aliceContext.routeWebSocket(/\/parties\//, (ws) => {
		if (relayReachable) ws.connectToServer();
		else ws.close();
	});
	await aliceContext.addInitScript(
		([key, id]) => window.localStorage.setItem(key as string, id as string),
		[WORKSPACE_STORAGE_KEY, workspaceId]
	);
	const alice = await aliceContext.newPage();
	await alice.goto('/issues');
	await expect(alice.getByText('No issues yet')).toBeVisible();
	await expect(alice.getByTestId('relay-status')).toHaveAttribute('data-synced', 'false');

	// Local-first: the write lands immediately even with nowhere to send it.
	const input = alice.getByPlaceholder('Add an issue and press Enter…');
	await input.fill('Written while cut off');
	await input.press('Enter');
	await expect(alice.getByRole('link', { name: 'Written while cut off' })).toBeVisible();
	// And it really did not reach anyone.
	await expect(bob.getByRole('link', { name: 'Written while cut off' })).toHaveCount(0);

	// Let the relay through and reload; the document is still in Alice's IndexedDB, so what
	// converges is a change made entirely offline.
	relayReachable = true;
	await alice.reload();
	await expect(alice.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 30_000
	});
	await expect(bob.getByRole('link', { name: 'Written while cut off' })).toBeVisible({
		timeout: 30_000
	});

	await Promise.all([aliceContext.close(), bob.context().close()]);
});

test('the relay keeps a workspace after every client has gone', async ({ browser }) => {
	// The invariant hibernation endangers: the room's in-memory document is evicted, so what
	// a later visitor sees has to come back from the Durable Object's own storage. Eviction
	// itself cannot be forced under `wrangler dev`, so this asserts the recoverable part.
	const workspaceId = room();
	const alice = await openPeer(browser, workspaceId);
	const input = alice.getByPlaceholder('Add an issue and press Enter…');
	await input.fill('Survives every client leaving');
	await input.press('Enter');
	await expect(alice.getByRole('link', { name: 'Survives every client leaving' })).toBeVisible();
	// Past the relay's save debounce before the last client disconnects.
	await alice.waitForTimeout(2500);
	await alice.context().close();

	// A brand-new context: empty IndexedDB, so anything it shows came from the relay.
	const later = await openPeer(browser, workspaceId);
	await expect(later.getByRole('link', { name: 'Survives every client leaving' })).toBeVisible({
		timeout: 30_000
	});
	await later.context().close();
});
