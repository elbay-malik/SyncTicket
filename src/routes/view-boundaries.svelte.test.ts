// A render bug in one record must cost that record's view, not the page. Everything here is the
// real thing around one deliberately throwing child: the real layout and board route, the real
// sheet, virtua's real Virtualizer and svelte-dnd-action's real zones. The child throws what the
// audit's duplicate labels threw, each_key_duplicate from a keyed {#each} during an update, which
// without a boundary leaves the whole page frozen.

import './layout.css';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { afterNavigate } from '$app/navigation';
import { shortcuts } from '$lib/keyboard/registry.svelte.js';
import { IssueStore } from '$lib/state/issues.svelte.js';
import type { RemoteChange } from '$lib/state/remote-change.js';
import { trap } from '$lib/components/shell/view-boundary.trace-trap.fixture.svelte';
import IssuesRoute from '$lib/components/shell/view-boundary.issues-route.fixture.svelte';
import IssueDetailSheet from '$lib/components/issues/issue-detail-sheet.svelte';
import BoardPage from './board/+page.svelte';

const current = vi.hoisted(() => ({ store: null as unknown }));

// Only a real app has routes to preload, and the rejection would be reported as this test's.
vi.mock('$app/navigation', async (importOriginal) => ({
	...(await importOriginal<typeof import('$app/navigation')>()),
	preloadCode: vi.fn(async () => {}),
	afterNavigate: vi.fn()
}));

vi.mock('$lib/state/issues.svelte.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/state/issues.svelte.js')>()),
	getIssueStore: () => current.store
}));

vi.mock('$lib/components/presence/remote-trace.svelte', async () => ({
	default: (await import('$lib/components/shell/view-boundary.trace-trap.fixture.svelte')).default
}));

vi.mock('$lib/components/ui/label/index.js', async () => {
	const fixture = await import('$lib/components/shell/view-boundary.label-trap.fixture.svelte');
	return { Label: fixture.default, Root: fixture.default };
});

const cleanups: Array<() => void> = [];
let logged: ReturnType<typeof vi.spyOn>;

function makeStore(): IssueStore {
	const store = new IssueStore(`boundary-${crypto.randomUUID()}`);
	current.store = store;
	cleanups.push(() => store.destroy());
	return store;
}

function makeHost(): HTMLElement {
	const host = document.createElement('div');
	host.style.height = '700px';
	document.body.appendChild(host);
	cleanups.push(() => host.remove());
	return host;
}

/** A peer's change to one issue, which is what puts `change` in front of the trap. */
const peerTouches = (store: IssueStore, issueId: string) =>
	store.remote.record({
		issueId,
		kind: 'status',
		title: 'Fix login',
		status: 'done',
		author: null,
		at: Date.now()
	} satisfies RemoteChange);

const retry = () => page.getByRole('button', { name: 'Try again' });
const failed = (name: string) => page.getByRole('status').getByText(name);

const eachKeyDuplicate = expect.objectContaining({
	message: expect.stringContaining('each_key_duplicate')
});

/** How many presses of the real Tab key it takes to focus `target`; Infinity if none do. */
async function tabsTo(target: HTMLElement, limit = 10): Promise<number> {
	for (let presses = 1; presses <= limit; presses += 1) {
		await userEvent.tab();
		if (document.activeElement === target) return presses;
	}
	return Infinity;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

/** Focus is on the new retry, and still is once a focus trap has had its say about the old one. */
async function expectFocusToStayOnRetry() {
	await vi.waitFor(() => expect(document.activeElement).toBe(retry().element()));
	await settle();
	expect(document.activeElement).toBe(retry().element());
}

/** Runs the layout's own afterNavigate handler, as closing the sheet on `cameFrom` would. */
async function returnFromSheet(cameFrom: string) {
	const handler = vi.mocked(afterNavigate).mock.lastCall?.[0] as (
		navigation: unknown
	) => Promise<void>;
	(document.activeElement as HTMLElement | null)?.blur();
	await handler({ from: { params: { id: cameFrom } } });
}

beforeEach(() => {
	trap.rows = false;
	trap.editor = false;
	logged = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	logged.mockRestore();
	while (cleanups.length) cleanups.pop()?.();
	shortcuts.setSuspended(false);
});

async function renderList() {
	const store = makeStore();
	const ids = [
		store.create({ title: 'Fix login', status: 'todo' }),
		store.create({ title: 'Ship it', status: 'todo' })
	];
	await render(IssuesRoute, { target: makeHost(), props: { store } });
	await expect.element(page.getByRole('link', { name: 'Fix login' })).toBeVisible();
	return { store, ids, id: ids[0] as string };
}

describe('the list', () => {
	it('fails on its own, in an update to one row', async () => {
		const { store, id } = await renderList();
		trap.rows = true;

		peerTouches(store, id);

		await expect.element(failed('The list couldn’t be shown')).toBeVisible();
		await expect.element(retry()).toBeVisible();
		expect(logged).toHaveBeenCalledWith(expect.any(String), eachKeyDuplicate);
		expect(page.getByTestId('issue-list').query()).toBeNull();
		// The page around it is still alive, and still reacts: this badge is outside the list.
		await expect.element(page.getByRole('heading', { name: 'Issues' })).toBeVisible();
		await page.getByRole('textbox', { name: 'New issue title' }).fill('Still works');
		await userEvent.keyboard('{Enter}');
		expect(store.all.map((issue) => issue.title)).toContain('Still works');
		await expect.element(page.getByText('3', { exact: true })).toBeVisible();
	});

	it('fails on its own when a row throws on its first render, into a list already up', async () => {
		const { store } = await renderList();
		trap.rows = true;

		// No other row has a change to trip on, so this is the new row's first render or nothing.
		peerTouches(store, store.create({ title: 'Brand new', status: 'todo' }));

		await expect.element(failed('The list couldn’t be shown')).toBeVisible();
		await expect.element(page.getByRole('heading', { name: 'Issues' })).toBeVisible();
	});

	it('fails on its own when a record is already bad as the page loads', async () => {
		const store = makeStore();
		peerTouches(store, store.create({ title: 'Fix login', status: 'todo' }));
		trap.rows = true;

		await render(IssuesRoute, { target: makeHost(), props: { store } });

		await expect.element(failed('The list couldn’t be shown')).toBeVisible();
		await expect.element(page.getByRole('heading', { name: 'Issues' })).toBeVisible();
	});

	it('reports once when several rows throw in the same update', async () => {
		const { store, ids } = await renderList();
		trap.rows = true;

		for (const id of ids) peerTouches(store, id);

		await expect.element(retry()).toBeVisible();
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(logged).toHaveBeenCalledTimes(1);
		expect(page.getByTestId('view-failed').elements()).toHaveLength(1);
	});

	it('comes back on retry once the record renders, and takes the keyboard back in', async () => {
		const { store, id } = await renderList();
		trap.rows = true;
		peerTouches(store, id);
		await expect.element(retry()).toBeVisible();

		trap.rows = false;
		await retry().click();

		await expect.element(page.getByRole('link', { name: 'Fix login' })).toBeVisible();
		expect(retry().query()).toBeNull();
		// The Virtualizer was rebuilt, with a tab stop of its own that Tab goes straight to.
		const stops = page.getByTestId('issue-list').element().querySelectorAll('a[tabindex="0"]');
		expect(stops).toHaveLength(1);
		expect(await tabsTo(stops[0] as HTMLElement)).toBe(1);
	});

	it('fails again, calmly, if the retry hits the same bug', async () => {
		const { store, id } = await renderList();
		trap.rows = true;
		peerTouches(store, id);
		await expect.element(retry()).toBeVisible();
		const before = logged.mock.calls.length;

		peerTouches(store, id);
		await retry().click();

		await expect.element(retry()).toBeVisible();
		await vi.waitFor(() => expect(logged.mock.calls.length).toBe(before + 1));
		expect(logged).toHaveBeenLastCalledWith(expect.any(String), eachKeyDuplicate);
	});

	it('hands the keyboard back to the retry when pressing it fails again', async () => {
		const { store, id } = await renderList();
		trap.rows = true;
		peerTouches(store, id);
		await expect.element(retry()).toBeVisible();
		(retry().element() as HTMLElement).focus();

		const before = logged.mock.calls.length;
		peerTouches(store, id);
		await userEvent.keyboard('{Enter}');
		await vi.waitFor(() => expect(logged.mock.calls.length).toBe(before + 1));
		await expect.element(retry()).toBeVisible();

		await expectFocusToStayOnRetry();
	});

	it('leaves focus alone when a retry that did not have it fails', async () => {
		const { store, id } = await renderList();
		const other = page.getByRole('button', { name: 'New issue' }).element() as HTMLElement;
		trap.rows = true;
		peerTouches(store, id);
		await expect.element(retry()).toBeVisible();
		other.focus();
		const before = logged.mock.calls.length;

		peerTouches(store, id);
		(retry().element() as HTMLElement).click();
		await vi.waitFor(() => expect(logged.mock.calls.length).toBe(before + 1));
		await expect.element(retry()).toBeVisible();
		await settle();

		expect(document.activeElement).toBe(other);
	});

	it('does not save the focus up for a failure long after a retry that worked', async () => {
		const { store, id } = await renderList();
		trap.rows = true;
		peerTouches(store, id);
		await expect.element(retry()).toBeVisible();
		(retry().element() as HTMLElement).focus();
		trap.rows = false;
		await userEvent.keyboard('{Enter}');
		await expect.element(page.getByRole('link', { name: 'Fix login' })).toBeVisible();
		await settle();

		const elsewhere = page.getByRole('button', { name: 'New issue' }).element() as HTMLElement;
		elsewhere.focus();
		trap.rows = true;
		peerTouches(store, id);
		await expect.element(retry()).toBeVisible();
		await settle();

		expect(document.activeElement).toBe(elsewhere);
	});

	it('lets a keyboard user reach the retry from the row that broke', async () => {
		const { store, id } = await renderList();
		const link = page.getByRole('link', { name: 'Fix login' }).element() as HTMLElement;
		link.focus();
		trap.rows = true;

		peerTouches(store, id);
		await expect.element(retry()).toBeVisible();

		expect(await tabsTo(retry().element() as HTMLElement)).toBe(1);
		trap.rows = false;
		await userEvent.keyboard('{Enter}');
		await expect.element(page.getByRole('link', { name: 'Fix login' })).toBeVisible();
	});

	it('leaves the list shortcuts harmless while it is down', async () => {
		const { store, id } = await renderList();
		trap.rows = true;
		peerTouches(store, id);
		await expect.element(retry()).toBeVisible();

		for (const shortcut of shortcuts.all.filter((entry) => entry.id.startsWith('list-'))) {
			expect(() => shortcut.run()).not.toThrow();
		}
	});

	it('leaves the sheet open in front of it working', async () => {
		const store = makeStore();
		const id = store.create({ title: 'Fix login', status: 'todo' });
		await render(IssuesRoute, { target: makeHost(), props: { store, openId: id } });
		const title = page.getByRole('dialog').getByLabelText('Title');
		await expect.element(title).toHaveValue('Fix login');
		trap.rows = true;

		peerTouches(store, id);
		await expect.element(page.getByText('The list couldn’t be shown')).toBeInTheDocument();

		store.update(id, { title: 'Renamed' });
		await expect.element(title).toHaveValue('Renamed');
	});
});

describe('putting focus back when the sheet closes', () => {
	it('still finds the row through the boundary', async () => {
		const { id } = await renderList();

		await returnFromSheet(id);

		expect(document.activeElement).toBe(page.getByRole('link', { name: 'Fix login' }).element());
	});

	it('falls back to New issue when the list that held the row has failed', async () => {
		const { store, id } = await renderList();
		trap.rows = true;
		peerTouches(store, id);
		await expect.element(retry()).toBeVisible();

		await returnFromSheet(id);

		expect(document.activeElement).toBe(page.getByRole('button', { name: 'New issue' }).element());
	});
});

describe('the board', () => {
	async function renderBoard() {
		const store = makeStore();
		const id = store.create({ title: 'Fix login', status: 'todo' });
		await render(BoardPage, { target: makeHost() });
		await expect.element(page.getByRole('listitem', { name: 'Fix login' })).toBeVisible();
		return { store, id };
	}

	it('fails on its own, keeps its heading, and comes back on retry', async () => {
		const { store, id } = await renderBoard();
		trap.rows = true;

		peerTouches(store, id);

		await expect.element(failed('The board couldn’t be shown')).toBeVisible();
		expect(logged).toHaveBeenCalledWith(expect.any(String), eachKeyDuplicate);
		expect(page.getByTestId('board-columns').query()).toBeNull();
		await expect.element(page.getByRole('heading', { name: 'Board' })).toBeVisible();

		expect(await tabsTo(retry().element() as HTMLElement)).toBeLessThan(Infinity);
		trap.rows = false;
		await userEvent.keyboard('{Enter}');
		await expect.element(page.getByRole('listitem', { name: 'Fix login' })).toBeVisible();
	});

	it('ends a keyboard drag cleanly when it fails mid-drag', async () => {
		const { store, id } = await renderBoard();
		const card = page.getByRole('listitem', { name: 'Fix login' }).element() as HTMLElement;
		card.focus();
		await userEvent.keyboard(' ');
		await vi.waitFor(() => expect(shortcuts.suspended).toBe(true));
		trap.rows = true;

		peerTouches(store, id);
		await expect.element(retry()).toBeVisible();

		expect(shortcuts.suspended).toBe(false);

		// And the rebuilt column can pick a card up and put it down again.
		trap.rows = false;
		await retry().click();
		const again = page.getByRole('listitem', { name: 'Fix login' }).element() as HTMLElement;
		again.focus();
		await userEvent.keyboard(' ');
		await vi.waitFor(() => expect(shortcuts.suspended).toBe(true));
		await userEvent.keyboard(' ');
		await vi.waitFor(() => expect(shortcuts.suspended).toBe(false));
	});

	it('lets a pointer drag finish when its column is gone', async () => {
		const { store, id } = await renderBoard();
		const other = store.create({ title: 'Another card', status: 'done' });
		await expect.element(page.getByRole('listitem', { name: 'Another card' })).toBeVisible();
		const card = page.getByRole('listitem', { name: 'Fix login' }).element() as HTMLElement;
		const { x, y } = card.getBoundingClientRect();
		const at = (dx: number) => ({ clientX: x + 20 + dx, clientY: y + 20, bubbles: true });
		card.dispatchEvent(new MouseEvent('mousedown', { ...at(0), button: 0 }));
		window.dispatchEvent(new MouseEvent('mousemove', at(20)));
		await vi.waitFor(() => expect(shortcuts.suspended).toBe(true));
		trap.rows = true;

		// The held card is a placeholder while it is held, so the record that breaks is another.
		peerTouches(store, other);
		await expect.element(retry()).toBeVisible();

		// The card is still in the visitor's hand, so the shortcuts rightly stay off. Letting go
		// reaches the board through the destroyed zone, and has to end the drag from there: a
		// stranded suspension kills every shortcut, and a stale preview would hide later edits.
		expect(shortcuts.suspended).toBe(true);
		window.dispatchEvent(new MouseEvent('mouseup', at(20)));
		await vi.waitFor(() => expect(shortcuts.suspended).toBe(false));
		await vi.waitFor(() => expect(document.getElementById('dnd-action-dragged-el')).toBeNull());

		trap.rows = false;
		store.update(id, { title: 'Renamed after the drag' });
		await retry().click();
		await expect
			.element(page.getByRole('listitem', { name: 'Renamed after the drag' }))
			.toBeVisible();
	});
});

describe('the issue sheet', () => {
	async function renderSheet() {
		const store = makeStore();
		const id = store.create({ title: 'Fix login', status: 'todo' });
		const onOpenChange = vi.fn();
		const view = await render(IssuesRoute, {
			target: makeHost(),
			props: { store, openId: id, onOpenChange }
		});
		const dialog = page.getByRole('dialog');
		await expect.element(dialog.getByRole('textbox', { name: 'Title' })).toBeVisible();
		// Opening moves focus into the dialog a moment later, which would land mid-test otherwise.
		await vi.waitFor(() => expect(dialog.element().contains(document.activeElement)).toBe(true));
		return { store, id, onOpenChange, dialog, view };
	}

	it('fails inside the dialog, which stays named and closable, with the list alive behind it', async () => {
		const { store, id, dialog, onOpenChange } = await renderSheet();
		trap.editor = true;
		store.update(id, { title: 'Renamed' });

		await expect.element(dialog.getByText('This issue couldn’t be shown')).toBeVisible();
		expect(logged).toHaveBeenCalledWith(expect.any(String), eachKeyDuplicate);
		await expect.element(page.getByRole('dialog', { name: 'Renamed' })).toBeVisible();
		await expect
			.element(page.getByRole('link', { name: 'Renamed', includeHidden: true }))
			.toBeInTheDocument();

		await userEvent.keyboard('{Escape}');
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it('keeps Delete, the way out of a record that cannot render', async () => {
		const { store, id, dialog } = await renderSheet();
		trap.editor = true;
		store.update(id, { description: 'Touched' });
		await expect.element(dialog.getByText('This issue couldn’t be shown')).toBeVisible();

		await dialog.getByRole('button', { name: 'Delete' }).click();
		await page.getByRole('button', { name: 'Delete issue' }).click();

		await vi.waitFor(() => expect(store.get(id)).toBeUndefined());
	});

	it('lets a keyboard user reach the retry from the field that broke, inside the focus trap', async () => {
		const { dialog, id, store } = await renderSheet();
		const field = dialog.getByRole('textbox', { name: 'Title' }).element() as HTMLElement;
		field.focus();
		trap.editor = true;
		store.update(id, { description: 'Touched' });
		await expect.element(retry()).toBeVisible();

		expect(await tabsTo(retry().element() as HTMLElement)).toBeLessThan(Infinity);
		expect(dialog.element().contains(document.activeElement)).toBe(true);

		trap.editor = false;
		await userEvent.keyboard('{Enter}');
		await expect.element(dialog.getByRole('textbox', { name: 'Title' })).toBeVisible();
	});

	it('keeps the keyboard on the retry when pressing it fails again, rather than on Delete', async () => {
		const { dialog, id, store } = await renderSheet();
		trap.editor = true;
		store.update(id, { description: 'Touched' });
		await expect.element(retry()).toBeVisible();
		(retry().element() as HTMLElement).focus();

		for (let attempt = 0; attempt < 3; attempt += 1) {
			const before = logged.mock.calls.length;
			await userEvent.keyboard('{Enter}');
			await vi.waitFor(() => expect(logged.mock.calls.length).toBe(before + 1));
			await expect.element(retry()).toBeVisible();
			await expectFocusToStayOnRetry();
			expect(page.getByRole('alertdialog').query()).toBeNull();
		}

		trap.editor = false;
		await userEvent.keyboard('{Enter}');
		await expect.element(dialog.getByRole('textbox', { name: 'Title' })).toBeVisible();
		expect(dialog.element().contains(document.activeElement)).toBe(true);
	});

	it('saves what was typed before the failure', async () => {
		const { dialog, id, store } = await renderSheet();
		await dialog.getByRole('textbox', { name: 'Description' }).fill('Typed before it broke');
		trap.editor = true;
		store.update(id, { assignee: 'Ada' });

		await expect.element(retry()).toBeVisible();

		expect(store.get(id)?.description).toBe('Typed before it broke');
	});

	it('gives another issue a fresh chance rather than showing it the last one’s failure', async () => {
		const { dialog, id, store, view } = await renderSheet();
		const other = store.create({ title: 'Other', status: 'todo' });
		trap.editor = true;
		store.update(id, { description: 'Touched' });
		await expect.element(retry()).toBeVisible();

		trap.editor = false;
		await view.rerender({ openId: other });

		await expect.element(dialog.getByRole('textbox', { name: 'Title' })).toHaveValue('Other');
		expect(retry().query()).toBeNull();
	});

	it('fails on its own when the editor throws on its first render', async () => {
		const store = makeStore();
		const id = store.create({ title: 'Solo', status: 'todo' });
		trap.editor = true;

		await render(IssueDetailSheet, { store, id, open: true, onOpenChange: vi.fn() });

		await expect.element(page.getByText('This issue couldn’t be shown')).toBeVisible();
	});
});
