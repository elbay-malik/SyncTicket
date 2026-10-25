// A peer's edit arriving is a visible, announced moment — the product's whole claim, made
// observable. Before this, a status change reached the other window in 3-29 ms and left no
// trace at all: the row just jumped to another section.
//
// Two contexts, not two pages: pages in one context share localStorage and so are one person
// in two tabs (see presence.e2e.ts). Identities are seeded so the author has a stable name.
// The workspace is seeded by hand into both, as relay.e2e.ts does, because the per-test
// fixture gives each context its own room.

import { expect, test, type Browser, type Page } from './fixtures.js';
import { IDENTITY_STORAGE_KEY } from '../src/lib/model/identity.js';
import { WORKSPACE_STORAGE_KEY } from '../src/lib/model/workspace.js';

const room = () => `t${crypto.randomUUID().replace(/-/g, '')}`;

const ADA = { userId: `u${'a'.repeat(32)}`, name: 'Ada Lovelace', hue: 210 };
const GRACE = { userId: `u${'b'.repeat(32)}`, name: 'Grace Hopper', hue: 12 };

async function openPeer(
	browser: Browser,
	workspaceId: string,
	identity: typeof ADA
): Promise<Page> {
	const context = await browser.newContext();
	await context.addInitScript(
		([wsKey, id, idKey, who]) => {
			window.localStorage.setItem(wsKey as string, id as string);
			window.localStorage.setItem(idKey as string, who as string);
		},
		[WORKSPACE_STORAGE_KEY, workspaceId, IDENTITY_STORAGE_KEY, JSON.stringify(identity)]
	);
	const page = await context.newPage();
	await page.goto('/issues');
	await expect(page.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 30_000
	});
	return page;
}

test('a peer’s status change is traced in their hue and announced in the other window', async ({
	browser
}) => {
	const workspaceId = room();
	const [ada, grace] = await Promise.all([
		openPeer(browser, workspaceId, ADA),
		openPeer(browser, workspaceId, GRACE)
	]);
	// Grace must know who Ada is before Ada edits, or the author is honestly "Someone".
	await expect(grace.getByTestId('presence-bar')).toHaveAttribute('data-peer-count', '2', {
		timeout: 10_000
	});

	const input = ada.getByPlaceholder('Add an issue…');
	await input.fill('Fix login redirect');
	await input.press('Enter');
	await expect(grace.getByRole('link', { name: 'Fix login redirect' })).toBeVisible({
		timeout: 10_000
	});
	// The creation is spoken on its own before the move is made. The announcer settles for
	// 500ms and says a burst as one sentence, and a test clicks faster than that: a status
	// change sent while the creation is still settling joins its burst and is read as "Ada
	// Lovelace changed …", which is the coalescing working, not the sentence this test is about.
	await expect(grace.getByTestId('remote-announcer')).toHaveText(
		'Ada Lovelace added “Fix login redirect”',
		{ timeout: 5_000 }
	);

	const adaRow = ada.getByRole('listitem').filter({ hasText: 'Fix login redirect' });
	await adaRow.getByRole('button', { name: 'Status: Backlog' }).click();
	await ada.getByRole('menuitemradio', { name: 'Done' }).click();

	// The trace lives for 1.2s, so it is caught while it is there rather than polled for later.
	const adaStatusTrace = '[data-remote-trace="status"][data-remote-author="Ada Lovelace"]';
	const trace = grace.locator(`[data-issue-row] ${adaStatusTrace}`);
	await expect(trace).toHaveCount(1, { timeout: 5_000 });
	// Drawn on the row that moved, which is now in the Done section. `has` is resolved inside
	// each candidate row, so it takes the trace's own selector — the page-rooted `trace` above
	// would look for a row nested in the row and match nothing.
	const traced = grace.locator('[data-issue-row]').filter({ has: grace.locator(adaStatusTrace) });
	await expect(traced.getByRole('link', { name: 'Fix login redirect' })).toBeVisible();
	await expect(traced.getByRole('button', { name: 'Status: Done' })).toBeVisible();

	// Polite and coalesced, so it can trail the creation's own announcement by the 2s gap.
	await expect(grace.getByTestId('remote-announcer')).toHaveText(
		'Ada Lovelace moved “Fix login redirect” to Done',
		{ timeout: 8_000 }
	);

	// The author's own window marks and announces nothing: it was her edit.
	await expect(ada.locator('[data-remote-trace]')).toHaveCount(0);
	await expect(ada.getByTestId('remote-announcer')).toHaveText('');

	await Promise.all([ada.context().close(), grace.context().close()]);
});

test('opening a share link to an existing workspace marks nothing', async ({ browser }) => {
	const workspaceId = room();
	const ada = await openPeer(browser, workspaceId, ADA);
	for (const title of ['First', 'Second', 'Third']) {
		const input = ada.getByPlaceholder('Add an issue…');
		await input.fill(title);
		await input.press('Enter');
	}

	// Grace arrives after the fact: the whole workspace reaches her as the relay's catch-up.
	const grace = await openPeer(browser, workspaceId, GRACE);
	await expect(grace.getByRole('link', { name: 'Third' })).toBeVisible({ timeout: 10_000 });
	await expect(grace.locator('[data-remote-trace]')).toHaveCount(0);
	await expect(grace.getByTestId('remote-notice')).toHaveCount(0);
	await expect(grace.getByTestId('remote-announcer')).toHaveText('');

	await Promise.all([ada.context().close(), grace.context().close()]);
});

test('on the board, a change that lands in a column scrolled out of view is noticed', async ({
	browser
}) => {
	const workspaceId = room();
	const [ada, grace] = await Promise.all([
		openPeer(browser, workspaceId, ADA),
		openPeer(browser, workspaceId, GRACE)
	]);
	await expect(grace.getByTestId('presence-bar')).toHaveAttribute('data-peer-count', '2', {
		timeout: 10_000
	});
	// At 1280 with the sidebar docked the board shows four columns and a sliver; Canceled,
	// the fifth, starts past the right edge of its scroller.
	await grace.setViewportSize({ width: 1280, height: 800 });
	await grace.getByRole('link', { name: 'Board', exact: true }).click();
	await expect(grace.getByTestId('board-columns')).toBeVisible();

	const input = ada.getByPlaceholder('Add an issue…');
	await input.fill('Fix login redirect');
	await input.press('Enter');
	// Landing in Backlog, in plain view: the card's own trace says it, so the notice does not.
	await expect(
		grace.getByTestId('board-columns').locator('[data-issue-id]', { hasText: 'Fix login redirect' })
	).toBeInViewport({ timeout: 10_000 });
	await expect(grace.getByTestId('remote-announcer')).toHaveText(
		'Ada Lovelace added “Fix login redirect”',
		{ timeout: 5_000 }
	);
	await expect(grace.getByTestId('remote-notice')).toHaveCount(0);

	const adaRow = ada.getByRole('listitem').filter({ hasText: 'Fix login redirect' });
	await adaRow.getByRole('button', { name: 'Status: Backlog' }).click();
	await ada.getByRole('menuitemradio', { name: 'Canceled' }).click();

	// The sentence, not the whole notice, which also carries the author's initials.
	await expect(grace.getByTestId('remote-notice').locator('[data-remote-notice-text]')).toHaveText(
		'Ada Lovelace moved “Fix login redirect” to Canceled',
		{ timeout: 5_000 }
	);

	await Promise.all([ada.context().close(), grace.context().close()]);
});
