// What the unit tests cannot show: a chain of nested types deeper than the stack going through the
// real relay, which runs the same Yjs under workerd, and into a real browser's real database. The
// peer is a plain Yjs client in this process, as in hostile-issue-id.e2e.ts.

import YProvider from 'y-partyserver/provider';
import * as Y from 'yjs';
import { expect, test, type Page } from './fixtures.js';

/** Must match RELAY_PORT in playwright.config.ts and RELAY_PARTY in src/lib/sync/provider.ts. */
const RELAY_HOST = 'localhost:18791';
const RELAY_PARTY = 'y-doc-room';

/** Past Chromium's limit, about 2,500 levels, for about 36 KB. */
const DEPTH = 3_000;

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

async function asPeer(workspaceId: string, write: (doc: Y.Doc) => void): Promise<void> {
	const doc = new Y.Doc();
	const provider = new YProvider(RELAY_HOST, workspaceId, doc, { party: RELAY_PARTY });
	await new Promise<void>((resolve) => {
		provider.once('synced', () => resolve());
	});
	write(doc);
	await new Promise((resolve) => setTimeout(resolve, 500));
	provider.destroy();
	doc.destroy();
}

function peerIssue(title: string, order: string): Y.Map<unknown> {
	const yIssue = new Y.Map<unknown>();
	yIssue.set('title', title);
	yIssue.set('status', 'todo');
	yIssue.set('priority', 'none');
	yIssue.set('order', order);
	return yIssue;
}

function nest(yIssue: Y.Map<unknown>): void {
	let current = new Y.Map<unknown>();
	yIssue.set('zzz', current);
	for (let level = 1; level < DEPTH; level += 1) {
		const next = new Y.Map<unknown>();
		current.set('n', next);
		current = next;
	}
}

test('an issue holding one can be deleted, by a second browser too, and the workspace reloads', async ({
	page,
	workspaceId
}) => {
	const errors = collectErrors(page);
	await openSynced(page);
	const id = crypto.randomUUID();
	await asPeer(workspaceId, (doc) => {
		const issues = doc.getMap<unknown>('issues');
		issues.set(crypto.randomUUID(), peerIssue('Kept', 'a0'));
		const yIssue = peerIssue('Innocent', 'a1');
		issues.set(id, yIssue);
		doc.transact(() => nest(yIssue));
	});
	const row = page.getByRole('link', { name: 'Innocent' });
	await expect(row).toBeVisible({ timeout: 10_000 });

	await row.click();
	const sheet = page.getByRole('dialog', { name: 'Innocent' });
	await sheet.getByRole('button', { name: 'Delete' }).click();
	await page.getByRole('button', { name: 'Delete issue' }).click();
	await expect(row).toHaveCount(0);

	await page.reload();
	await expect(page.getByRole('link', { name: 'Kept' })).toBeVisible();
	await expect(row).toHaveCount(0);
	expect(errors).toEqual([]);

	// The relay took the delete too: someone new is told the same thing, and it still takes writes.
	await asPeer(workspaceId, (doc) => {
		expect(doc.getMap<unknown>('issues').has(id)).toBe(false);
		doc.getMap<unknown>('issues').set(crypto.randomUUID(), peerIssue('After', 'a2'));
	});
	await expect(page.getByRole('link', { name: 'After' })).toBeVisible({ timeout: 10_000 });
	expect(errors).toEqual([]);
});

test('one that arrives already deleted leaves no ghost, and the room goes on working', async ({
	page,
	workspaceId
}) => {
	const errors = collectErrors(page);
	await openSynced(page);

	await asPeer(workspaceId, (doc) => {
		const issues = doc.getMap<unknown>('issues');
		const id = crypto.randomUUID();
		const yIssue = peerIssue('Innocent', 'a1');
		issues.set(id, yIssue);
		doc.transact(() => nest(yIssue));
		issues.delete(id);
	});
	await asPeer(workspaceId, (doc) => {
		doc.getMap<unknown>('issues').set(crypto.randomUUID(), peerIssue('After', 'a2'));
	});

	await expect(page.getByRole('link', { name: 'After' })).toBeVisible({ timeout: 10_000 });
	await expect(page.getByRole('link', { name: 'Innocent' })).toHaveCount(0);

	await page.reload();
	await expect(page.getByRole('link', { name: 'After' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Innocent' })).toHaveCount(0);
	expect(errors).toEqual([]);
});
