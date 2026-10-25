// The five steps in docs/DEMO.md, run end to end. This is what keeps that document honest:
// the wording quoted there is asserted here verbatim, not just the mechanics — a Playwright
// locator can pass on `getByTestId` alone while the copy underneath it has quietly drifted,
// so this checks the exact sentences a person reading the doc will actually see.

import { expect, test, type Page } from './fixtures.js';
import { WORKSPACE_STORAGE_KEY } from '../src/lib/model/workspace.js';

/** Opens the connection popover, reads both lines, and closes it again. */
async function readStatus(page: Page): Promise<{ stored: string; shared: string }> {
	await page.getByTestId('relay-status').click();
	await expect(page.getByTestId('connection-details')).toBeVisible();
	const stored = await page.getByTestId('connection-stored').innerText();
	const shared = await page.getByTestId('connection-shared').innerText();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('connection-details')).toHaveCount(0);
	return { stored, shared };
}

const room = () => `t${crypto.randomUUID().replace(/-/g, '')}`;

test('the demo script: share, converge, edit the same field, go offline, come back', async ({
	browser
}) => {
	// Step 1 — a workspace of your own. No relay is reachable yet from either side, so this
	// context starts genuinely local: the id is seeded, but nothing routes to the relay.
	const workspaceId = room();
	const aliceContext = await browser.newContext();
	// Blocked, not merely unconfigured — this proves the "no relay configured" copy is
	// reachable in an environment (this test suite) that always sets PUBLIC_RELAY_HOST.
	// The rest of the script needs a real, working relay, so this block is lifted right
	// after step 1's assertion rather than staying on for the whole test.
	let relayBlocked = true;
	await aliceContext.routeWebSocket(/\/parties\//, (ws) => {
		if (relayBlocked) ws.close();
		else ws.connectToServer();
	});
	await aliceContext.addInitScript(
		([key, id]) => window.localStorage.setItem(key as string, id as string),
		[WORKSPACE_STORAGE_KEY, workspaceId]
	);
	const alice = await aliceContext.newPage();
	await alice.goto('/issues');
	await expect(alice.getByTestId('relay-status')).toHaveAttribute('data-connection', 'offline', {
		timeout: 10_000
	});

	relayBlocked = false;
	await expect(alice.getByTestId('relay-status')).toHaveAttribute('data-connection', 'connected', {
		timeout: 30_000
	});
	const step1 = await readStatus(alice);
	expect(step1.stored).toBe('Saved on this device');
	expect(step1.shared).toBe('Ready to share — no one else here yet');

	// Step 2 — share it, and converge. A second, unrelated browser context stands in for a
	// second person: no shared storage with Alice's context, only the link. Presence
	// propagates over the same connection document sync does, so by the time Bob's page has
	// synced, both sides already see each other — there is no reliably observable moment in
	// between where Bob's own popover would still say "no one else here yet".
	const shareUrl = await alice.getByTestId('share-workspace').getAttribute('data-share-url');
	const bobContext = await browser.newContext();
	const bob = await bobContext.newPage();
	await bob.goto(shareUrl as string);
	await expect(bob.getByText('No issues yet')).toBeVisible();
	await expect(bob.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 30_000
	});
	await expect
		.poll(async () => (await readStatus(bob)).shared, { timeout: 10_000 })
		.toBe('Shared with 1 other');

	const input = alice.getByPlaceholder('Add an issue…');
	await input.fill('Seen by both');
	await input.press('Enter');
	await expect(bob.getByRole('link', { name: 'Seen by both' })).toBeVisible({ timeout: 10_000 });

	const step2After = await readStatus(alice);
	expect(step2After.shared).toBe('Shared with 1 other');

	// Step 3 — the same field, edited from both sides. The doc is explicit that the winner
	// is not predictable, so only convergence is asserted here, never a specific value —
	// the mechanics of *why* that is are covered in relay.e2e.ts's own LWW test.
	await alice.getByRole('link', { name: 'Seen by both' }).click();
	const aliceTitle = alice.getByTestId('issue-sheet').getByRole('textbox', { name: 'Title' });
	await bob.getByRole('link', { name: 'Seen by both' }).click();
	const bobTitle = bob.getByTestId('issue-sheet').getByRole('textbox', { name: 'Title' });

	await aliceTitle.fill("Alice's edit");
	await aliceTitle.press('Enter');
	await bobTitle.fill("Bob's edit");
	await bobTitle.press('Enter');

	// Both values read fresh on every poll and compared to each other, never against a
	// snapshot taken before the poll started — see relay.e2e.ts's LWW test for why that
	// distinction matters here (Alice's own field is equally free to change after Bob's
	// edit is the one that survives).
	await expect
		.poll(
			async () => {
				const [a, b] = await Promise.all([aliceTitle.inputValue(), bobTitle.inputValue()]);
				return a === b ? 'converged' : `${a} !== ${b}`;
			},
			{ timeout: 10_000 }
		)
		.toBe('converged');
	// Leaves both sheets open otherwise, which would sit over the header and intercept the
	// clicks step 4 needs.
	await alice.keyboard.press('Escape');
	await bob.keyboard.press('Escape');
	await expect(alice.getByTestId('issue-sheet')).toHaveCount(0);

	// Step 4 — go offline. A real browser-level signal, the same one `context.setOffline`
	// produces for airplane mode, rather than the relay-routing trick used elsewhere in this
	// file — the doc's claim is specifically about what the *browser* going offline does.
	await alice.context().setOffline(true);
	await expect(alice.getByTestId('relay-status')).toHaveAttribute('data-connection', 'offline', {
		timeout: 800
	});
	const step4 = await readStatus(alice);
	expect(step4.shared).toBe("Not shared — you're offline");

	const offlineInput = alice.getByPlaceholder('Add an issue…');
	await offlineInput.fill('Written offline');
	await offlineInput.press('Enter');
	await expect(alice.getByRole('link', { name: 'Written offline' })).toBeVisible();
	await expect(bob.getByRole('link', { name: 'Written offline' })).toHaveCount(0);

	// Step 5 — come back. No reload anywhere in this test; the same live pages recover and
	// converge on their own.
	await alice.context().setOffline(false);
	await expect(alice.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 15_000
	});
	await expect(bob.getByRole('link', { name: 'Written offline' })).toBeVisible({
		timeout: 15_000
	});
	// Document sync (checked above via `data-synced`) and presence resync are two separate
	// exchanges over the same reconnected socket — the first landing first is not a promise
	// this app makes, so this polls rather than reading the popover the instant one of them
	// completes.
	await expect
		.poll(async () => (await readStatus(alice)).shared, { timeout: 10_000 })
		.toBe('Shared with 1 other');
	expect((await readStatus(alice)).stored).toBe('Saved on this device');

	await Promise.all([aliceContext.close(), bobContext.close()]);
});
