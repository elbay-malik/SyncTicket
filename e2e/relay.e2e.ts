// Phase 9 acceptance: two browsers in the same workspace converge through the relay.
//
// These tests deliberately do not use the per-test workspace fixture the way the others do:
// they need two contexts in the *same* room, so the id is seeded into both by hand.

import {
	committedUpdates,
	expect,
	test,
	waitForCommitAbove,
	type Browser,
	type Page
} from './fixtures.js';
import {
	DEFAULT_WORKSPACE_ID,
	WORKSPACE_STORAGE_KEY,
	workspaceDbName
} from '../src/lib/model/workspace.js';

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

	const input = alice.getByPlaceholder('Add an issue…');
	await input.fill('Written by Alice');
	await input.press('Enter');

	await expect(bob.getByRole('link', { name: 'Written by Alice' })).toBeVisible({
		timeout: 10_000
	});

	// And the other direction, on the same pair.
	const bobInput = bob.getByPlaceholder('Add an issue…');
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
		const input = alice.getByPlaceholder('Add an issue…');
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
	const aliceDb = workspaceDbName(workspaceId);
	const baseline = await committedUpdates(alice, aliceDb);

	// Local-first: the write lands immediately even with nowhere to send it.
	const input = alice.getByPlaceholder('Add an issue…');
	await input.fill('Written while cut off');
	await input.press('Enter');
	await expect(alice.getByRole('link', { name: 'Written while cut off' })).toBeVisible();
	// And it really did not reach anyone.
	await expect(bob.getByRole('link', { name: 'Written while cut off' })).toHaveCount(0);

	// Let the relay through and reload; the document is still in Alice's IndexedDB, so what
	// converges is a change made entirely offline. Not before it has committed, though: a
	// reload that lands first discards the write with the old page, Alice comes back to an
	// empty workspace and syncs it in good faith, and the relay never hears of the issue.
	await waitForCommitAbove(alice, aliceDb, baseline);
	relayReachable = true;
	await alice.reload();
	// Checked before Bob, so a write lost on Alice's side cannot pass for a sync failure.
	await expect(alice.getByRole('link', { name: 'Written while cut off' })).toBeVisible();
	await expect(alice.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 30_000
	});
	await expect(bob.getByRole('link', { name: 'Written while cut off' })).toBeVisible({
		timeout: 30_000
	});

	await Promise.all([aliceContext.close(), bob.context().close()]);
});

test('a socket cut mid-session recovers on its own, and both sides converge without a reload', async ({
	browser
}) => {
	// The existing offline test above proves persistence: it reloads, so what converges could
	// just as easily have come from IndexedDB. This proves reconnection — the same live page,
	// the same in-memory Y.Doc, no reload — by cutting an already-open, already-synced socket
	// and waiting for the provider's own backoff to bring it back.
	const workspaceId = room();
	const bob = await openPeer(browser, workspaceId);

	// `ws` is re-bound on every new WebSocket the page opens, including the reconnect this
	// test waits for — routeWebSocket's handler fires fresh each time (verified against the
	// installed Playwright: it re-invokes per socket, reconnects included).
	let relayReachable = true;
	const aliceContext = await browser.newContext();
	let currentWs: Parameters<Parameters<typeof aliceContext.routeWebSocket>[1]>[0] | null = null;
	await aliceContext.routeWebSocket(/\/parties\//, (ws) => {
		currentWs = ws;
		if (relayReachable) ws.connectToServer();
		else ws.close();
	});
	await aliceContext.addInitScript(
		([key, id]) => window.localStorage.setItem(key as string, id as string),
		[WORKSPACE_STORAGE_KEY, workspaceId]
	);
	const alice = await aliceContext.newPage();
	await alice.goto('/issues');
	await expect(alice.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 30_000
	});

	// The cut: block future connection attempts, then force the live one closed. Blocking
	// alone would not be enough — the socket that is already open would just sit there,
	// looking connected, until something actually severs it.
	relayReachable = false;
	await currentWs?.close();
	await expect(alice.getByTestId('relay-status')).toHaveAttribute('data-connection', 'offline', {
		timeout: 5_000
	});

	// Both sides write while apart — this is the case the AC actually names, not just one.
	const aliceInput = alice.getByPlaceholder('Add an issue…');
	await aliceInput.fill("Written while Alice couldn't reach anyone");
	await aliceInput.press('Enter');
	const bobInput = bob.getByPlaceholder('Add an issue…');
	await bobInput.fill("Written while Bob couldn't reach Alice");
	await bobInput.press('Enter');
	await expect(
		alice.getByRole('link', { name: "Written while Bob couldn't reach Alice" })
	).toHaveCount(0);
	await expect(
		bob.getByRole('link', { name: "Written while Alice couldn't reach anyone" })
	).toHaveCount(0);

	// Reconnect and let the provider's own backoff do the rest — no reload anywhere below.
	relayReachable = true;
	await expect(alice.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 30_000
	});
	await expect(
		bob.getByRole('link', { name: "Written while Alice couldn't reach anyone" })
	).toBeVisible({ timeout: 15_000 });
	await expect(
		alice.getByRole('link', { name: "Written while Bob couldn't reach Alice" })
	).toBeVisible({ timeout: 15_000 });

	await Promise.all([aliceContext.close(), bob.context().close()]);
});

test('a relay outage longer than the reconnect breaker allowed still recovers on its own', async ({
	browser
}) => {
	// An open, synced tab whose relay then refuses every connection for 16 seconds. Every
	// refused attempt used to count towards the breaker meant for a relay that accepts and
	// then closes, so after about 13 seconds the tab stopped trying for good and stayed
	// "Offline" until a reload. See guardReconnects in src/lib/sync/provider.ts.
	test.setTimeout(120_000);
	const workspaceId = room();
	const bob = await openPeer(browser, workspaceId);

	let relayReachable = true;
	let attempts = 0;
	const aliceContext = await browser.newContext();
	let currentWs: Parameters<Parameters<typeof aliceContext.routeWebSocket>[1]>[0] | null = null;
	await aliceContext.routeWebSocket(/\/parties\//, (ws) => {
		currentWs = ws;
		attempts += 1;
		if (relayReachable) ws.connectToServer();
		else ws.close();
	});
	await aliceContext.addInitScript(
		([key, id]) => window.localStorage.setItem(key as string, id as string),
		[WORKSPACE_STORAGE_KEY, workspaceId]
	);
	const alice = await aliceContext.newPage();
	await alice.goto('/issues');
	await expect(alice.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 30_000
	});

	relayReachable = false;
	const before = attempts;
	await currentWs?.close();
	await expect(alice.getByTestId('relay-status')).toHaveAttribute('data-connection', 'offline', {
		timeout: 5_000
	});
	const aliceInput = alice.getByPlaceholder('Add an issue…');
	await aliceInput.fill('Written during a long relay outage');
	await aliceInput.press('Enter');
	await alice.waitForTimeout(16_000);
	// The old breaker tripped at eight closes: the cut, then seven refused attempts by 12.7s.
	expect(attempts - before).toBeGreaterThanOrEqual(7);

	relayReachable = true;
	await expect(alice.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 40_000
	});
	await expect(bob.getByRole('link', { name: 'Written during a long relay outage' })).toBeVisible({
		timeout: 15_000
	});

	await Promise.all([aliceContext.close(), bob.context().close()]);
});

test('editing the same field on both sides while apart converges to one value, not two', async ({
	browser
}) => {
	// Yjs resolves a same-key conflict by comparing each edit's client id, which is a fresh
	// random number per Y.Doc — so which side's text survives is not something this test (or
	// the demo built on the same scenario, docs/DEMO.md) can predict or should assert. What
	// must be true is that both browsers end up showing the exact same title, not each their
	// own — a merge that silently forked would be far worse than one whose winner is a coin
	// flip.
	const workspaceId = room();
	const bob = await openPeer(browser, workspaceId);

	let relayReachable = true;
	const aliceContext = await browser.newContext();
	let currentWs: Parameters<Parameters<typeof aliceContext.routeWebSocket>[1]>[0] | null = null;
	await aliceContext.routeWebSocket(/\/parties\//, (ws) => {
		currentWs = ws;
		if (relayReachable) ws.connectToServer();
		else ws.close();
	});
	await aliceContext.addInitScript(
		([key, id]) => window.localStorage.setItem(key as string, id as string),
		[WORKSPACE_STORAGE_KEY, workspaceId]
	);
	const alice = await aliceContext.newPage();
	await alice.goto('/issues');
	await expect(alice.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 30_000
	});

	// One issue, agreed on before the split, so both sides are editing the very same key.
	const input = alice.getByPlaceholder('Add an issue…');
	await input.fill('Original title');
	await input.press('Enter');
	const link = bob.getByRole('link', { name: 'Original title' });
	await expect(link).toBeVisible({ timeout: 10_000 });

	relayReachable = false;
	await currentWs?.close();
	await expect(alice.getByTestId('relay-status')).toHaveAttribute('data-connection', 'offline', {
		timeout: 5_000
	});

	// Alice edits it from the detail sheet.
	await alice.getByRole('link', { name: 'Original title' }).click();
	const aliceTitle = alice.getByTestId('issue-sheet').getByRole('textbox', { name: 'Title' });
	await aliceTitle.fill("Alice's version");
	await aliceTitle.press('Enter');

	// Bob edits the very same field of the very same issue, while Alice cannot hear him.
	await link.click();
	const bobTitle = bob.getByTestId('issue-sheet').getByRole('textbox', { name: 'Title' });
	await bobTitle.fill("Bob's version");
	await bobTitle.press('Enter');

	relayReachable = true;
	await expect(alice.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 30_000
	});

	// Convergence, not a predicted winner: both sides must show the same title within a few
	// seconds of reconnecting, whichever text that turns out to be. Both values are read
	// fresh on every poll and compared to each other, never against a value snapshotted
	// before the poll started — Alice's own field can still change after reconnecting (her
	// edit does not have to be the one that wins), so a stale snapshot of "what Alice showed
	// when this poll began" is not the same question as "do they agree right now."
	await expect
		.poll(
			async () => {
				const [a, b] = await Promise.all([aliceTitle.inputValue(), bobTitle.inputValue()]);
				return a === b ? 'converged' : `${a} !== ${b}`;
			},
			{ timeout: 15_000 }
		)
		.toBe('converged');

	await Promise.all([aliceContext.close(), bob.context().close()]);
});

test('the browser reporting itself offline updates the status at once, and recovery does not wait out backoff', async ({
	browser
}) => {
	// The one signal this module treats as certain rather than merely uncertain-and-dwelled:
	// the browser's own online/offline events. `context.setOffline()` does not close an
	// already-open socket by itself (verified against the installed Playwright), so what
	// proves this path is specifically wired up is the status flipping straight to 'offline'
	// well inside the 1.2s dwell an ordinary retry blip would sit behind.
	const workspaceId = room();
	const page = await openPeer(browser, workspaceId);
	const status = page.getByTestId('relay-status');

	const context = page.context();
	await context.setOffline(true);
	await expect(status).toHaveAttribute('data-connection', 'offline', { timeout: 800 });

	// Local-first regardless: the edit lands even while the badge says offline.
	const input = page.getByPlaceholder('Add an issue…');
	await input.fill('Written the instant offline was reported');
	await input.press('Enter');
	await expect(
		page.getByRole('link', { name: 'Written the instant offline was reported' })
	).toBeVisible();

	await context.setOffline(false);
	await expect(status).toHaveAttribute('data-synced', 'true', { timeout: 15_000 });
	await context.close();
});

test('two tabs of the same browser converge over BroadcastChannel even with the relay unreachable', async ({
	browser
}) => {
	// Two pages in one context, per Phase 10's own established fact about this environment:
	// they share both localStorage and a BroadcastChannel, which is what makes them the same
	// person in two tabs rather than two people. The relay is routed to refuse every
	// connection for the whole test, so nothing here can be mistaken for relay convergence —
	// the only path an edit can travel is the provider's local BroadcastChannel, subscribed
	// the moment it is constructed rather than once it actually connects.
	const workspaceId = room();
	const context = await browser.newContext();
	await context.routeWebSocket(/\/parties\//, (ws) => ws.close());
	await context.addInitScript(
		([key, id]) => window.localStorage.setItem(key as string, id as string),
		[WORKSPACE_STORAGE_KEY, workspaceId]
	);

	const tabOne = await context.newPage();
	await tabOne.goto('/issues');
	await expect(tabOne.getByTestId('relay-status')).toHaveAttribute('data-connection', 'offline', {
		timeout: 10_000
	});
	const tabTwo = await context.newPage();
	await tabTwo.goto('/issues');
	await expect(tabTwo.getByText('No issues yet')).toBeVisible();

	const input = tabOne.getByPlaceholder('Add an issue…');
	await input.fill('Seen in the other tab with no relay in reach');
	await input.press('Enter');

	await expect(
		tabTwo.getByRole('link', { name: 'Seen in the other tab with no relay in reach' })
	).toBeVisible({ timeout: 5_000 });

	await context.close();
});

test('the relay keeps a workspace after every client has gone', async ({ browser }) => {
	// The invariant hibernation endangers: the room's in-memory document is evicted, so what
	// a later visitor sees has to come back from the Durable Object's own storage. Eviction
	// itself cannot be forced under `wrangler dev`, so this asserts the recoverable part.
	const workspaceId = room();
	const alice = await openPeer(browser, workspaceId);
	const input = alice.getByPlaceholder('Add an issue…');
	await input.fill('Survives every client leaving');
	await input.press('Enter');
	await expect(alice.getByRole('link', { name: 'Survives every client leaving' })).toBeVisible();
	// Past the relay's save debounce before the last client disconnects. Sized against the
	// CEILING (`debounceMaxWait: 5000`), not the trailing wait: a second document update
	// landing shortly after the first rearms the 2 s trailing timer, so a wait chosen for the
	// trailing value alone can close the context before `onSave` has run and this test then
	// fails as real data loss. It was 2500 when the ceiling was 2000.
	await alice.waitForTimeout(6000);
	await alice.context().close();

	// A brand-new context: empty IndexedDB, so anything it shows came from the relay.
	const later = await openPeer(browser, workspaceId);
	await expect(later.getByRole('link', { name: 'Survives every client leaving' })).toBeVisible({
		timeout: 30_000
	});
	await later.context().close();
});

test('the share link is the whole demo: mint, invite, sync, and stay private', async ({
	browser
}) => {
	// Deliberately no workspace fixture on these contexts: the point is what a real visitor
	// gets with an untouched browser.
	const aliceContext = await browser.newContext();
	const alice = await aliceContext.newPage();
	await alice.goto('/issues');
	await expect(alice.getByText('No issues yet')).toBeVisible();

	// A first-time visitor lands in a workspace of their own, not a shared one.
	const workspaceId = await alice.evaluate(
		(key) => window.localStorage.getItem(key),
		WORKSPACE_STORAGE_KEY
	);
	expect(workspaceId).not.toBe(DEFAULT_WORKSPACE_ID);
	expect(workspaceId ?? '').toMatch(/^w[0-9a-f]{32}$/);

	const shareUrl = await alice.getByTestId('share-workspace').getAttribute('data-share-url');
	expect(shareUrl).toContain(`ws=${workspaceId}`);

	const input = alice.getByPlaceholder('Add an issue…');
	await input.fill('Ship the demo');
	await input.press('Enter');
	await expect(alice.getByRole('link', { name: 'Ship the demo' })).toBeVisible();

	// Someone opens the link in a different browser and nothing else.
	const bobContext = await browser.newContext();
	const bob = await bobContext.newPage();
	await bob.goto(shareUrl as string);
	await expect(bob.getByRole('link', { name: 'Ship the demo' })).toBeVisible({ timeout: 30_000 });

	// They are in the same workspace, and it works both ways from here.
	const bobWorkspace = await bob.evaluate(
		(key) => window.localStorage.getItem(key),
		WORKSPACE_STORAGE_KEY
	);
	expect(bobWorkspace).toBe(workspaceId);

	const bobInput = bob.getByPlaceholder('Add an issue…');
	await bobInput.fill('Reply from Bob');
	await bobInput.press('Enter');
	await expect(alice.getByRole('link', { name: 'Reply from Bob' })).toBeVisible({
		timeout: 30_000
	});

	// A browser that was never given the link sees none of it — the id is the only thing
	// protecting a workspace in demo mode (ADR 0004).
	const strangerContext = await browser.newContext();
	const stranger = await strangerContext.newPage();
	await stranger.goto('/issues');
	await expect(stranger.getByText('No issues yet')).toBeVisible();
	await expect(stranger.getByRole('link', { name: 'Ship the demo' })).toHaveCount(0);

	await Promise.all([aliceContext.close(), bobContext.close(), strangerContext.close()]);
});

test("undo takes back my own change across a merge, and never the other browser's", async ({
	browser
}) => {
	// The one demonstration that a CRDT is really here rather than asserted in a README, and
	// the one safety property that makes undo usable at all in a workspace with no accounts:
	// Yjs tracks only transactions whose origin is in `trackedOrigins` (default: null). Local
	// mutations transact with no origin; IndexedDB and the relay apply with their provider as
	// origin. So Alice's ⌘Z can reach Alice's edits and can never reach Bob's — which is the
	// difference between an undo and a remote delete button.
	const workspaceId = room();
	const alice = await openPeer(browser, workspaceId);
	const bob = await openPeer(browser, workspaceId);

	const add = async (page: Page, title: string) => {
		const field = page.getByRole('textbox', { name: 'New issue title' });
		await field.fill(title);
		await field.press('Enter');
		await expect(page.getByRole('link', { name: title })).toBeVisible();
	};

	await add(alice, 'Alice wrote this');
	await add(bob, 'Bob wrote this');

	// Both converge before the undo, so the stack is exercised against a merged document
	// rather than against the state Alice last saw on her own.
	await expect(alice.getByRole('link', { name: 'Bob wrote this' })).toBeVisible({
		timeout: 15_000
	});
	await expect(bob.getByRole('link', { name: 'Alice wrote this' })).toBeVisible({
		timeout: 15_000
	});

	// Away from the quick-add field, because inside an input ⌘Z belongs to the browser's own
	// text undo and this shortcut deliberately does not take it. The heading is inert, so this
	// leaves focus on the document rather than on any control.
	await alice.getByRole('heading', { name: 'Issues' }).click();
	await alice.keyboard.press('ControlOrMeta+z');

	// Alice's own issue is gone, on both sides.
	await expect(alice.getByRole('link', { name: 'Alice wrote this' })).toBeHidden({
		timeout: 15_000
	});
	await expect(bob.getByRole('link', { name: 'Alice wrote this' })).toBeHidden({
		timeout: 15_000
	});

	// And Bob's survived it — the assertion the whole scoping exists for. Pressing undo again
	// must not reach further into a document that now contains somebody else's work.
	await alice.keyboard.press('ControlOrMeta+z');
	await expect(alice.getByRole('link', { name: 'Bob wrote this' })).toBeVisible();
	await expect(bob.getByRole('link', { name: 'Bob wrote this' })).toBeVisible();

	await alice.context().close();
	await bob.context().close();
});

test('the invitation to open a second window appears alone and leaves when answered', async ({
	browser
}) => {
	// The surface demonstrating its claim rather than asserting it in a caption. The condition
	// is three pieces of relay state at once, which is precisely the kind of thing that stops
	// rendering without anyone noticing — the ADR 0004 disclosure already did exactly that by
	// living in a branch only the empty state reached.
	const workspaceId = room();
	const alice = await openPeer(browser, workspaceId);

	const invitation = alice.getByTestId('second-window-invite');
	await expect(invitation).toBeVisible();

	// A second peer arriving is the proof, so it is also the dismissal: nobody has to be told
	// twice, and there is no dismiss control to leave lying around.
	const bob = await openPeer(browser, workspaceId);
	await expect(invitation).toBeHidden({ timeout: 15_000 });
	await expect(bob.getByTestId('second-window-invite')).toBeHidden();

	// And it comes back when they leave, because the invitation is true again.
	await bob.context().close();
	await expect(invitation).toBeVisible({ timeout: 20_000 });

	await alice.context().close();
});
