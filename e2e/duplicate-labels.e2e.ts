// What the unit tests cannot show: the real wire, and the routes as the Worker renders them. A
// peer connected to the relay repeats a label, which used to throw each_key_duplicate in the
// list, on the board and in the editor, on every load, for everyone in the workspace.
//
// The peer is a plain Yjs client in this process rather than a second page. The app dedupes what
// it writes, so no page could send this.

import YProvider from 'y-partyserver/provider';
import * as Y from 'yjs';
import { expect, test, type Page } from './fixtures.js';

/** Must match RELAY_PORT in playwright.config.ts and RELAY_PARTY in src/lib/sync/provider.ts. */
const RELAY_HOST = 'localhost:18791';
const RELAY_PARTY = 'y-doc-room';

/** Anything thrown in the page, and whatever hydration said about the Worker's markup. */
function collectProblems(page: Page): string[] {
	const problems: string[] = [];
	page.on('pageerror', (error) => problems.push(error.message));
	page.on('console', (message) => {
		if (message.text().includes('hydration')) problems.push(message.text());
	});
	return problems;
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

test('a label a peer repeats renders once everywhere, and on every load', async ({
	page,
	workspaceId
}) => {
	const problems = collectProblems(page);
	await page.goto('/issues');
	await expect(page.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 30_000
	});

	const id = crypto.randomUUID();
	await asPeer(workspaceId, (issues) => {
		const yIssue = new Y.Map<unknown>();
		yIssue.set('title', 'Repeated label');
		yIssue.set('status', 'todo');
		yIssue.set('priority', 'none');
		yIssue.set('order', 'a0');
		yIssue.set('labels', ['dup', 'dup']);
		issues.set(id, yIssue);
	});

	// Arriving at a list that is already on screen.
	const row = page.locator(`[data-issue-row="${id}"]`);
	await expect(row.getByText('dup', { exact: true })).toHaveCount(1, { timeout: 10_000 });

	// And again from the document alone, which is what the next visit starts from.
	await page.reload();
	await expect(row.getByText('dup', { exact: true })).toHaveCount(1);

	await page.goto('/board');
	const card = page.locator(`[data-issue-id="${id}"]`);
	await expect(card.getByText('dup', { exact: true })).toHaveCount(1);

	await page.goto(`/issues/${id}`);
	const sheet = page.getByRole('dialog');
	await expect(sheet.getByRole('textbox', { name: 'Labels' })).toHaveValue('dup');
	await expect(sheet.getByText('dup', { exact: true })).toHaveCount(1);

	await expect(page.getByTestId('view-failed')).toHaveCount(0);
	expect(problems).toEqual([]);
});

test('the Worker renders every guarded route, and none of them as a failure', async ({
	page,
	workspaceId
}) => {
	const problems = collectProblems(page);
	for (const path of ['/issues', '/board', `/issues/${crypto.randomUUID()}`]) {
		const response = await page.request.get(`${path}?ws=${workspaceId}`);
		expect(response.status(), path).toBe(200);
		const html = await response.text();
		expect(html, path).toContain('id="main-content"');
		expect(html, path).not.toContain('view-failed');

		// The hydration of that same markup is what could disagree with it.
		await page.goto(path);
		await expect(page.getByRole('main')).toBeVisible();
	}
	await expect(page.getByTestId('view-failed')).toHaveCount(0);
	expect(problems).toEqual([]);
});
