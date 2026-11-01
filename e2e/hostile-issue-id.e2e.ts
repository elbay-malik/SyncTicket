// What the unit tests cannot show: the real wire, the real router and a browser's own URL
// normalisation. A peer connected to the relay plants issues under keys that are not ids, and
// a hand-typed address tries the same thing from the other end.
//
// The peer is a plain Yjs client in this process rather than a second page. The app only ever
// mints good ids, so no page could send these.

import YProvider from 'y-partyserver/provider';
import * as Y from 'yjs';
import { WORKSPACE_STORAGE_KEY } from '../src/lib/model/workspace.js';
import { expect, onRoute, test, type Page } from './fixtures.js';

/** Must match RELAY_PORT in playwright.config.ts and RELAY_PARTY in src/lib/sync/provider.ts. */
const RELAY_HOST = 'localhost:18791';
const RELAY_PARTY = 'y-doc-room';

const STOLEN_LINK = `../issues?ws=w${'deadbeef'.repeat(4)}`;

const remembered = (page: Page) =>
	page.evaluate((key) => window.localStorage.getItem(key), WORKSPACE_STORAGE_KEY);

/** Fails the test on anything thrown in the page, which is how a bad row used to show up. */
function collectErrors(page: Page): Error[] {
	const errors: Error[] = [];
	page.on('pageerror', (error) => errors.push(error));
	return errors;
}

async function openSynced(page: Page): Promise<void> {
	await page.goto('/issues');
	await expect(page.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 30_000
	});
}

/** Connects a replica to the room, runs `write` once it has caught up, and leaves. */
async function asPeer(workspaceId: string, write: (issues: Y.Map<unknown>) => void): Promise<void> {
	const doc = new Y.Doc();
	const provider = new YProvider(RELAY_HOST, workspaceId, doc, { party: RELAY_PARTY });
	await new Promise<void>((resolve) => {
		provider.once('synced', () => resolve());
	});
	write(doc.getMap<unknown>('issues'));
	// Let the update leave before the socket goes.
	await new Promise((resolve) => setTimeout(resolve, 500));
	provider.destroy();
	doc.destroy();
}

function peerIssue(title: string): Y.Map<unknown> {
	const yIssue = new Y.Map<unknown>();
	yIssue.set('title', title);
	yIssue.set('status', 'todo');
	yIssue.set('priority', 'none');
	yIssue.set('order', 'a0');
	return yIssue;
}

test('issues a peer plants under keys that are not ids never become rows or links', async ({
	page,
	workspaceId
}) => {
	const errors = collectErrors(page);
	await openSynced(page);

	const real = crypto.randomUUID();
	await asPeer(workspaceId, (issues) => {
		for (const key of [STOLEN_LINK, '', '/x', 'x/', '..']) issues.set(key, peerIssue('Fix login'));
		issues.set(real, peerIssue('From a real client'));
	});

	const row = page.getByRole('link', { name: 'From a real client' });
	await expect(row).toBeVisible({ timeout: 10_000 });
	await expect(page.getByText('Fix login')).toHaveCount(0);
	await expect(page.locator('a[href*="ws="], a[href*=".."]')).toHaveCount(0);

	// The same again from the document alone, which is what the next visit starts from.
	await page.reload();
	await expect(row).toBeVisible();
	await expect(page.getByText('Fix login')).toHaveCount(0);

	// And the board, which is the other place an issue becomes something to click.
	await page.goto('/board');
	await expect(page.getByRole('listitem', { name: 'From a real client' })).toBeVisible();
	await expect(page.getByText('Fix login')).toHaveCount(0);

	expect(errors).toEqual([]);
	expect(await remembered(page)).toBe(workspaceId);
});

test('a real id survives the round trip through the link, the router and a reload', async ({
	page,
	workspaceId
}) => {
	const errors = collectErrors(page);
	await openSynced(page);
	const id = crypto.randomUUID();
	await asPeer(workspaceId, (issues) => issues.set(id, peerIssue('Round trip')));

	const row = page.getByRole('link', { name: 'Round trip' });
	await expect(row).toHaveAttribute('href', `/issues/${id}`, { timeout: 10_000 });
	await row.click();

	// The sheet finds the issue, so `page.params.id` came back as the id that went in.
	await expect(page).toHaveURL(onRoute(`/issues/${id}`));
	await expect(page.getByRole('dialog', { name: 'Round trip' })).toBeVisible();

	await page.reload();
	await expect(page.getByRole('dialog', { name: 'Round trip' })).toBeVisible();
	expect(errors).toEqual([]);
});

for (const segment of [
	'..%2Fissues%3Fws%3Dx',
	'..%2F..%2Fboard',
	'%2Fx',
	'x%2F',
	'%00',
	'x%0A',
	'corrupt',
	'00000000-0000-4000-8000-00000000000A',
	// decodeURI refuses these. SvelteKit's client would throw on them while starting and never
	// hydrate, so the server sends them to the same text properly encoded (hooks.server.ts).
	'%',
	'%E0%A4%A',
	'%ZZ',
	'%FF',
	'%C0%AF',
	'%ED%A0%80'
]) {
	test(`typing /issues/${segment} is an issue that was not found, in the same workspace`, async ({
		page,
		workspaceId
	}) => {
		const errors = collectErrors(page);
		await page.goto(`/issues/${segment}`);

		await expect(page.getByTestId('issue-sheet')).toContainText('Issue not found');
		expect(await remembered(page)).toBe(workspaceId);
		expect(new URL(page.url()).searchParams.get('ws')).toBe(workspaceId);

		await page.getByRole('button', { name: 'Back to issues' }).click();
		await expect(page).toHaveURL(onRoute('/issues'));
		expect(errors).toEqual([]);
	});
}
