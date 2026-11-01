// The tab names the open issue, and has to stop when the issue goes. Losing it while the editor
// held a draft used to throw out of the flush, and the update to the title was the one that was
// lost: the tab went on naming a deleted issue, even after later edits. The real layout and sheet.

import '../layout.css';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import IssuesRoute from '$lib/components/shell/view-boundary.issues-route.fixture.svelte';
import { IssueStore } from '$lib/state/issues.svelte.js';
import { peerWrites } from '$lib/sync/junk-entries.fixture.js';

const current = vi.hoisted(() => ({
	store: null as unknown,
	params: {} as Record<string, string>
}));

vi.mock('$app/state', () => ({
	page: {
		get params() {
			return current.params;
		},
		url: new URL('http://localhost/issues')
	}
}));

vi.mock('$app/navigation', async (importOriginal) => ({
	...(await importOriginal<typeof import('$app/navigation')>()),
	preloadCode: vi.fn(async () => {}),
	afterNavigate: vi.fn()
}));

vi.mock('$lib/state/issues.svelte.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/state/issues.svelte.js')>()),
	getIssueStore: () => current.store
}));

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length) cleanups.pop()?.();
});

async function openOn() {
	let attached = null as Y.Doc | null;
	const store = new IssueStore(`tab-${crypto.randomUUID()}`, {
		attachRelay: (doc) => {
			attached = doc;
			const awareness = new Awareness(doc);
			clearInterval(awareness._checkInterval);
			return { provider: null, awareness, destroy: () => awareness.destroy() };
		}
	});
	cleanups.push(() => store.destroy());
	await vi.waitFor(() => expect(store.synced).toBe(true));
	const id = store.create({ title: 'Doomed', status: 'todo' });
	current.store = store;
	current.params = { id };
	await render(IssuesRoute, { props: { store, openId: id } });
	const dialog = page.getByRole('dialog');
	await expect.element(dialog.getByRole('textbox', { name: 'Title' })).toBeVisible();
	await vi.waitFor(() => expect(dialog.element().contains(document.activeElement)).toBe(true));
	return {
		id,
		dialog,
		peer: (write: (issues: Y.Map<unknown>) => void) =>
			peerWrites(attached as unknown as Y.Doc, write)
	};
}

describe('the tab title of an open issue', () => {
	it.each([
		{ loss: 'deleted', take: (issues: Y.Map<unknown>, id: string) => issues.delete(id) },
		{ loss: 'overwritten', take: (issues: Y.Map<unknown>, id: string) => issues.set(id, 'junk') }
	])('stops naming it when a peer has $loss it under a draft', async ({ take }) => {
		const { id, dialog, peer } = await openOn();
		await expect.poll(() => document.title).toBe('Doomed · Issues · SyncTicket');
		await dialog.getByRole('textbox', { name: 'Description' }).fill('Half typed');

		peer((issues) => take(issues, id));

		await expect.element(dialog.getByRole('button', { name: 'Back to issues' })).toBeVisible();
		await expect.poll(() => document.title).toBe('Issues · SyncTicket');
	});
});
