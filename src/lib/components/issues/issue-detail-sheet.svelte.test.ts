// Phase 4 acceptance for the detail sheet: every field round-trips through the CRDT, and a
// mutation is reflected within one frame.
//
// The one-frame assertion is deliberately a *synchronous* expect after flushSync — a
// polling `expect.element` would pass even if the update landed several frames later, which
// is precisely the property under test.

import { flushSync } from 'svelte';
import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { IssueStore } from '$lib/state/issues.svelte.js';
import IssueDetailSheet from './issue-detail-sheet.svelte';

const stores: IssueStore[] = [];

function makeStore() {
	const store = new IssueStore(`test-${crypto.randomUUID()}`);
	stores.push(store);
	return store;
}

afterEach(() => {
	while (stores.length) stores.pop()?.destroy();
});

/** Renders the sheet and waits out the store's async IndexedDB sync (skeleton → editor). */
async function open(store: IssueStore, id: string) {
	const onOpenChange = vi.fn();
	await render(IssueDetailSheet, { store, id, open: true, onOpenChange });
	const title = page.getByRole('dialog').getByLabelText('Title');
	await expect.element(title).toBeVisible();
	return { onOpenChange, title };
}

describe('issue-detail-sheet.svelte', () => {
	it('reflects an external CRDT mutation within one frame', async () => {
		const store = makeStore();
		const id = store.create({ title: 'Alpha' });
		const { title } = await open(store, id);
		await expect.element(title).toHaveValue('Alpha');

		// A write from "elsewhere" (another tab, or the Phase 9 relay).
		store.update(id, { title: 'Beta' });
		flushSync();
		expect((title.element() as HTMLInputElement).value).toBe('Beta');
	});

	it('commits a title edit on Enter and ignores a blank one', async () => {
		const store = makeStore();
		const id = store.create({ title: 'Original' });
		const { title } = await open(store, id);

		await title.fill('Renamed');
		await userEvent.keyboard('{Enter}');
		expect(store.get(id)?.title).toBe('Renamed');

		// Blanking the field must not persist an empty title; the input snaps back.
		await title.fill('   ');
		await userEvent.keyboard('{Enter}');
		expect(store.get(id)?.title).toBe('Renamed');
		await expect.element(title).toHaveValue('Renamed');
	});

	it('reverts the field being edited on Escape, then closes on a second Escape', async () => {
		const store = makeStore();
		const id = store.create({ title: 'Keep me' });
		const { title, onOpenChange } = await open(store, id);

		await title.fill('Discard me');
		await userEvent.keyboard('{Escape}');
		await expect.element(title).toHaveValue('Keep me');
		expect(store.get(id)?.title).toBe('Keep me');
		expect(onOpenChange).not.toHaveBeenCalled();

		// With no draft in flight, Escape reaches the sheet and closes it.
		await userEvent.keyboard('{Escape}');
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it('writes status and priority through the pickers', async () => {
		const store = makeStore();
		const id = store.create({ title: 'Pickers' });
		await open(store, id);
		const sheet = page.getByRole('dialog');

		await sheet.getByRole('button', { name: 'Status: Backlog' }).click();
		await page.getByRole('menuitemradio', { name: 'In Progress' }).click();
		expect(store.get(id)?.status).toBe('in_progress');

		await sheet.getByRole('button', { name: 'Priority: No priority' }).click();
		await page.getByRole('menuitemradio', { name: 'Urgent' }).click();
		expect(store.get(id)?.priority).toBe('urgent');
	});

	it('parses labels and normalises a blank assignee to null', async () => {
		const store = makeStore();
		const id = store.create({ title: 'Fields' });
		await open(store, id);
		const sheet = page.getByRole('dialog');

		await sheet.getByLabelText('Labels').fill(' bug , ui, bug ');
		await userEvent.keyboard('{Enter}');
		expect(store.get(id)?.labels).toEqual(['bug', 'ui']);

		await sheet.getByLabelText('Assignee').fill('ada');
		await userEvent.keyboard('{Enter}');
		expect(store.get(id)?.assignee).toBe('ada');

		await sheet.getByLabelText('Assignee').fill('  ');
		await userEvent.keyboard('{Enter}');
		expect(store.get(id)?.assignee).toBeNull();
	});

	it('saves the description on Ctrl+Enter', async () => {
		const store = makeStore();
		const id = store.create({ title: 'Described' });
		await open(store, id);

		await page.getByRole('dialog').getByLabelText('Description').fill('Steps to reproduce');
		// Control, not Meta: CI runs Linux, where Meta is the Super key.
		await userEvent.keyboard('{Control>}{Enter}{/Control}');
		expect(store.get(id)?.description).toBe('Steps to reproduce');
	});

	it('deletes only after confirmation, then closes the sheet', async () => {
		const store = makeStore();
		const id = store.create({ title: 'Doomed' });
		const { onOpenChange } = await open(store, id);

		await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
		const confirm = page.getByRole('alertdialog');
		await expect.element(confirm).toBeVisible();

		// Cancelling must leave the issue alone. Wait for the exit animation to finish before
		// reopening, or the closing dialog and the new one are both in the DOM.
		await confirm.getByRole('button', { name: 'Cancel' }).click();
		await expect.element(confirm).not.toBeInTheDocument();
		expect(store.get(id)).toBeDefined();

		await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
		await page.getByRole('alertdialog').getByRole('button', { name: 'Delete issue' }).click();
		expect(store.get(id)).toBeUndefined();
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it('shows a not-found state for an unknown id', async () => {
		const store = makeStore();
		store.create({ title: 'Something else' });
		const onOpenChange = vi.fn();
		await render(IssueDetailSheet, { store, id: 'missing-id', open: true, onOpenChange });
		// The dialog names itself for assistive tech in this state, not just in the body.
		await expect.element(page.getByRole('dialog', { name: 'Issue not found' })).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Back to issues' })).toBeVisible();
	});
});
