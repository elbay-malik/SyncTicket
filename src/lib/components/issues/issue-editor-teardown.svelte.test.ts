// An editor can lose its issue while it holds a draft: a peer deletes it, or overwrites its entry
// with something that is not an issue, and the sheet takes the editor down around the draft. Blur
// fires as the input leaves the page and onDestroy flushes what was left, both after the `issue`
// prop has gone undefined. Neither throw reaches a boundary, and the one from onDestroy escapes
// the flush, so the update after it on the page is lost too: the tab kept the deleted issue's title.

import '../../../routes/layout.css';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { IssueStore } from '$lib/state/issues.svelte.js';
import { peerWrites } from '$lib/sync/junk-entries.fixture.js';
import IssueDetailSheet from './issue-detail-sheet.svelte';
import { IDLE_COMMIT_MS } from './issue-editor.svelte';

const cleanups: Array<() => void> = [];
const uncaught: unknown[] = [];

const onError = (event: ErrorEvent) => {
	uncaught.push(event.error);
	event.preventDefault();
};
const onRejection = (event: PromiseRejectionEvent) => {
	uncaught.push(event.reason);
	event.preventDefault();
};

beforeEach(() => {
	uncaught.length = 0;
	window.addEventListener('error', onError);
	window.addEventListener('unhandledrejection', onRejection);
	cleanups.push(() => {
		window.removeEventListener('error', onError);
		window.removeEventListener('unhandledrejection', onRejection);
	});
});

afterEach(() => {
	while (cleanups.length) cleanups.pop()?.();
});

/** A sheet open on one issue of a loaded store, and a peer who can reach that store. */
async function openSheet() {
	let attached = null as Y.Doc | null;
	const store = new IssueStore(`teardown-${crypto.randomUUID()}`, {
		attachRelay: (doc) => {
			attached = doc;
			const awareness = new Awareness(doc);
			clearInterval(awareness._checkInterval);
			return { provider: null, awareness, destroy: () => awareness.destroy() };
		}
	});
	cleanups.push(() => store.destroy());
	await vi.waitFor(() => expect(store.synced).toBe(true));
	const id = store.create({ title: 'Doomed', description: 'Text' });
	const view = await render(IssueDetailSheet, { store, id, open: true, onOpenChange: () => {} });
	const dialog = page.getByRole('dialog');
	await expect.element(dialog.getByRole('textbox', { name: 'Title' })).toBeVisible();
	// Opening moves focus into the dialog a moment later, which would land mid-test otherwise.
	await vi.waitFor(() => expect(dialog.element().contains(document.activeElement)).toBe(true));
	return {
		store,
		id,
		view,
		dialog,
		peer: (write: (issues: Y.Map<unknown>) => void) =>
			peerWrites(attached as unknown as Y.Doc, write)
	};
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe.each([
	{ loss: 'a peer deleting it', take: (issues: Y.Map<unknown>, id: string) => issues.delete(id) },
	{
		loss: 'a peer overwriting it',
		take: (issues: Y.Map<unknown>, id: string) => issues.set(id, 'junk')
	}
])('the editor losing its issue to $loss', ({ take }) => {
	it.each([
		{ field: 'Title', draft: 'Half typed' },
		{ field: 'Title', draft: '   ' },
		{ field: 'Description', draft: 'Half typed' },
		{ field: 'Assignee', draft: 'Ada' },
		{ field: 'Labels', draft: 'a, b' }
	])('stays quiet with a $field draft of "$draft" in focus', async ({ field, draft }) => {
		const { id, dialog, peer } = await openSheet();
		await dialog.getByRole('textbox', { name: field }).fill(draft);

		peer((issues) => take(issues, id));

		await expect.element(dialog.getByRole('button', { name: 'Back to issues' })).toBeVisible();
		await settle();
		expect(uncaught).toEqual([]);
	});

	it('stays quiet with a draft that has already been committed once while idle', async () => {
		const { store, id, dialog, peer } = await openSheet();
		await dialog.getByRole('textbox', { name: 'Title' }).fill('Half typed');
		await vi.waitFor(() => expect(store.get(id)?.title).toBe('Half typed'), {
			timeout: IDLE_COMMIT_MS * 4
		});

		peer((issues) => take(issues, id));

		await expect.element(dialog.getByRole('button', { name: 'Back to issues' })).toBeVisible();
		await settle();
		expect(uncaught).toEqual([]);
	});

	it('does not let the pending idle commit fire afterwards', async () => {
		const { id, dialog, peer } = await openSheet();
		await dialog.getByRole('textbox', { name: 'Title' }).fill('Half typed');

		peer((issues) => take(issues, id));

		await expect.element(dialog.getByRole('button', { name: 'Back to issues' })).toBeVisible();
		await new Promise((resolve) => setTimeout(resolve, IDLE_COMMIT_MS * 2));
		expect(uncaught).toEqual([]);
	});

	it('leaves the page updating, and the way back working', async () => {
		const { store, id, dialog, peer } = await openSheet();
		const other = store.create({ title: 'Other' });
		await dialog.getByRole('textbox', { name: 'Title' }).fill('Half typed');

		peer((issues) => take(issues, id));
		const back = dialog.getByRole('button', { name: 'Back to issues' });
		await expect.element(back).toBeVisible();
		await settle();

		// An update after the one the throw would have ended.
		peer((issues) => (issues.get(other) as Y.Map<unknown>).set('title', 'Other, renamed'));
		expect(store.get(other)?.title).toBe('Other, renamed');
		await expect.element(back).toBeVisible();
		expect(uncaught).toEqual([]);
	});
});

describe('the editor leaving for another issue with a draft', () => {
	it('saves the draft on the issue it was typed for', async () => {
		const { store, id, view, dialog } = await openSheet();
		const next = store.create({ title: 'Next', description: 'Untouched' });
		await dialog.getByRole('textbox', { name: 'Description' }).fill('Typed for the first');

		await view.rerender({ id: next });
		await expect.element(dialog.getByRole('textbox', { name: 'Title' })).toHaveValue('Next');

		expect(store.get(id)?.description).toBe('Typed for the first');
		expect(store.get(next)?.description).toBe('Untouched');
		expect(uncaught).toEqual([]);
	});

	it.each([
		{ field: 'Assignee', property: 'assignee' as const, draft: 'Ada' },
		{ field: 'Title', property: 'title' as const, draft: 'Typed for the first' }
	])('saves a $field draft on the issue it was typed for', async ({ field, property, draft }) => {
		const { store, id, view, dialog } = await openSheet();
		const next = store.create({ title: 'Next' });
		const before = store.get(next)?.[property];
		await dialog.getByRole('textbox', { name: field }).fill(draft);

		await view.rerender({ id: next });
		await expect.element(dialog.getByRole('textbox', { name: 'Title' })).toHaveValue('Next');

		expect(store.get(id)?.[property]).toBe(draft);
		expect(store.get(next)?.[property]).toBe(before);
	});
});
