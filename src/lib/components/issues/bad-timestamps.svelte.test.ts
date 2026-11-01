// The real editor in the real sheet, on a time a peer wrote that a Date can't hold. It used to fail
// on every open, for everyone, with Delete the only way out, because nothing can edit `createdAt`.

import '../../../routes/layout.css';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { IssueStore } from '$lib/state/issues.svelte.js';
import { peerWrites } from '$lib/sync/junk-entries.fixture.js';
import IssueDetailSheet from './issue-detail-sheet.svelte';

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length) cleanups.pop()?.();
});

async function openOn(fields: Record<string, unknown>) {
	let attached = null as Y.Doc | null;
	const store = new IssueStore(`times-${crypto.randomUUID()}`, {
		attachRelay: (doc) => {
			attached = doc;
			const awareness = new Awareness(doc);
			clearInterval(awareness._checkInterval);
			return { provider: null, awareness, destroy: () => awareness.destroy() };
		}
	});
	cleanups.push(() => store.destroy());
	await vi.waitFor(() => expect(store.synced).toBe(true));
	const id = store.create({ title: 'Fix login' });
	peerWrites(attached as unknown as Y.Doc, (issues) => {
		const yIssue = issues.get(id) as Y.Map<unknown>;
		for (const [field, value] of Object.entries(fields)) yIssue.set(field, value);
	});
	await render(IssueDetailSheet, { store, id, open: true, onOpenChange: () => {} });
	return { store, id };
}

const editorTitle = () => page.getByRole('dialog').getByRole('textbox', { name: 'Title' });
const times = () => [...document.querySelectorAll('[data-testid="issue-sheet"] time')];

describe('the editor on a time a Date cannot hold', () => {
	it.each([
		{ field: 'createdAt', value: 1e300 },
		{ field: 'createdAt', value: 8640000000000001 },
		{ field: 'createdAt', value: 1e308 },
		{ field: 'updatedAt', value: 8650000000000000 },
		{ field: 'updatedAt', value: -8650000000000000 }
	])('opens on $field = $value', async ({ field, value }) => {
		await openOn({ [field]: value });

		await expect.element(editorTitle()).toHaveValue('Fix login');
		expect(page.getByTestId('view-failed').query()).toBeNull();
		expect(times()).toHaveLength(2);
	});

	it('shows both fields falling back, with no datetime for the one that has no time', async () => {
		await openOn({ createdAt: 1e300, updatedAt: 1e300 });

		await expect.element(editorTitle()).toBeVisible();
		for (const time of times()) expect(time.hasAttribute('datetime')).toBe(false);
	});

	it('still shows the last time a Date can hold', async () => {
		await openOn({ createdAt: 8.64e15 });

		await expect.element(editorTitle()).toBeVisible();
		expect(times()[0]?.getAttribute('datetime')).toBe('+275760-09-13T00:00:00.000Z');
	});
});
