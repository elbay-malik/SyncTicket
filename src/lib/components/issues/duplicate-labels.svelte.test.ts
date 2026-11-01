// The audit's exploit from the visitor's side: a peer stores `labels: ['dup', 'dup']`, and the
// real row, card and editor have to render it. They key their badges by the label's text, so
// before readLabels deduped, each one threw each_key_duplicate, on every load, for everyone.

import '../../../routes/layout.css';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { IssueStore } from '$lib/state/issues.svelte.js';
import { getIssuesMap } from '$lib/sync/doc.js';
import { peerWrites } from '$lib/sync/junk-entries.fixture.js';
import BoardColumn from './board-column.svelte';
import IssueDetailSheet from './issue-detail-sheet.svelte';
import IssueList from './issue-list.svelte';

const LABEL = 'dup-label';

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length) cleanups.pop()?.();
});

function makeHost(): HTMLElement {
	const host = document.createElement('div');
	host.style.height = '400px';
	document.body.appendChild(host);
	cleanups.push(() => host.remove());
	return host;
}

/** A loaded store holding one issue, and a peer who can repeat its labels over the wire. */
async function makeWorkspace() {
	let attached = null as Y.Doc | null;
	const store = new IssueStore(`labels-${crypto.randomUUID()}`, {
		attachRelay: (doc) => {
			attached = doc;
			const awareness = new Awareness(doc);
			clearInterval(awareness._checkInterval);
			return { provider: null, awareness, destroy: () => awareness.destroy() };
		}
	});
	cleanups.push(() => store.destroy());
	await vi.waitFor(() => expect(store.synced).toBe(true));
	const doc = attached as unknown as Y.Doc;
	const id = store.create({ title: 'Fix login', status: 'todo' });
	const stored = () => (getIssuesMap(doc).get(id) as Y.Map<unknown>).get('labels');
	const repeat = () =>
		peerWrites(doc, (issues) => (issues.get(id) as Y.Map<unknown>).set('labels', [LABEL, LABEL]));
	return { store, doc, id, stored, repeat };
}

/** The badges in an element, wherever the responsive classes have hidden them. */
const badges = (root: Element) =>
	[...root.querySelectorAll('[data-slot="badge"]')].map((badge) => badge.textContent?.trim());

/**
 * The labels field of an editor that has finished opening. The dialog moves focus into itself a
 * moment after it mounts, and on a loaded machine that lands in the middle of a `fill`, whose text
 * then goes into the title instead.
 */
async function labelsField(value: string) {
	const dialog = page.getByRole('dialog');
	const field = dialog.getByLabelText('Labels');
	await expect.element(field).toHaveValue(value);
	await vi.waitFor(() => expect(dialog.element().contains(document.activeElement)).toBe(true));
	return field;
}

const settle = () =>
	new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

describe('a label a peer repeats', () => {
	it('reaches the projection once', async () => {
		const { store, id, repeat, stored } = await makeWorkspace();
		repeat();
		expect(stored()).toEqual([LABEL, LABEL]);
		expect(store.get(id)?.labels).toEqual([LABEL]);
	});

	it('renders once on a list row that was already on screen', async () => {
		const { store, id, repeat } = await makeWorkspace();
		const host = makeHost();
		const list = await render(IssueList, { target: host, props: { issues: store.all, store } });
		await settle();

		repeat();
		await list.rerender({ issues: store.all });
		await settle();

		const row = host.querySelector(`[data-issue-row="${id}"]`) as Element;
		expect(badges(row)).toEqual([LABEL]);
	});

	it('renders once on a list row opened after it arrived', async () => {
		const { store, id, repeat } = await makeWorkspace();
		repeat();
		const host = makeHost();
		await render(IssueList, { target: host, props: { issues: store.all, store } });
		await settle();

		const row = host.querySelector(`[data-issue-row="${id}"]`) as Element;
		expect(badges(row)).toEqual([LABEL]);
	});

	it('renders once on a board card', async () => {
		const { store, id, repeat } = await makeWorkspace();
		const host = makeHost();
		const props = { status: 'todo' as const, onconsider: () => {}, onfinalize: () => {} };
		const column = await render(BoardColumn, {
			target: host,
			props: { ...props, items: store.all }
		});

		repeat();
		await column.rerender({ items: store.all });
		await settle();

		const card = host.querySelector(`[data-issue-id="${id}"]`) as Element;
		expect(badges(card)).toEqual([LABEL]);
	});

	it('renders once in the editor, delivered while it is open', async () => {
		const { store, id, repeat } = await makeWorkspace();
		await render(IssueDetailSheet, { store, id, open: true, onOpenChange: vi.fn() });
		const field = page.getByRole('dialog').getByLabelText('Labels');
		await expect.element(field).toHaveValue('');

		repeat();

		await expect.element(field).toHaveValue(LABEL);
		expect(badges(page.getByRole('dialog').element())).toEqual([LABEL]);
	});

	it('renders once in an editor opened after it arrived', async () => {
		const { store, id, repeat } = await makeWorkspace();
		repeat();
		await render(IssueDetailSheet, { store, id, open: true, onOpenChange: vi.fn() });
		const field = page.getByRole('dialog').getByLabelText('Labels');

		await expect.element(field).toHaveValue(LABEL);
		expect(badges(page.getByRole('dialog').element())).toEqual([LABEL]);
	});

	it('writes nothing when the editor saves the same label back', async () => {
		const { store, id, doc, repeat, stored } = await makeWorkspace();
		repeat();
		const updatedAt = store.get(id)?.updatedAt;
		await render(IssueDetailSheet, { store, id, open: true, onOpenChange: vi.fn() });
		const field = await labelsField(LABEL);
		const updates: Uint8Array[] = [];
		doc.on('update', (update: Uint8Array) => updates.push(update));

		await field.fill(`${LABEL}, ${LABEL}`);
		await userEvent.keyboard('{Enter}');

		expect(updates).toEqual([]);
		expect(stored()).toEqual([LABEL, LABEL]);
		expect(store.get(id)?.updatedAt).toBe(updatedAt);
		await expect.element(field).toHaveValue(LABEL);
	});

	it('is repaired by the editor once the labels really change', async () => {
		const { store, id, repeat, stored } = await makeWorkspace();
		repeat();
		await render(IssueDetailSheet, { store, id, open: true, onOpenChange: vi.fn() });
		const field = await labelsField(LABEL);

		await field.fill(`${LABEL}, other`);
		await userEvent.keyboard('{Enter}');

		expect(stored()).toEqual([LABEL, 'other']);
		await expect.element(field).toHaveValue(`${LABEL}, other`);
		expect(badges(page.getByRole('dialog').element())).toEqual([LABEL, 'other']);
	});
});
