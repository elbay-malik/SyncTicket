// Phase 4 acceptance for creation: keyboard submit, no blank titles, and a cancelled draft
// that does not survive into the next open (the form lives inside Dialog.Content, which
// bits-ui unmounts on close — that is what makes the reset real rather than cosmetic).

import { page, userEvent, type Locator } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { IssueStore } from '$lib/state/issues.svelte.js';
import IssueCreateDialog from './issue-create-dialog.svelte';

/**
 * Fills a field and confirms the text stuck before moving on.
 *
 * `fill()` resolves once it has written the DOM value and dispatched `input`; roughly once
 * in twenty-five runs of this file the value is back to empty a moment later, and only when
 * the whole file runs (30/30 passes in isolation). Retrying costs nothing and turns a
 * confusing "created with an empty description" failure into a deterministic step.
 */
async function fillField(field: Locator, text: string) {
	await vi.waitFor(async () => {
		await field.fill(text);
		expect((field.element() as HTMLInputElement | HTMLTextAreaElement).value).toBe(text);
	});
}

const stores: IssueStore[] = [];

function makeStore() {
	const store = new IssueStore(`test-${crypto.randomUUID()}`);
	stores.push(store);
	return store;
}

afterEach(() => {
	while (stores.length) stores.pop()?.destroy();
});

const dialog = () => page.getByRole('dialog', { name: 'New issue' });

describe('issue-create-dialog.svelte', () => {
	it('creates an issue on Enter in the title field and closes', async () => {
		const store = makeStore();
		const onOpenChange = vi.fn();
		await render(IssueCreateDialog, { store, open: true, onOpenChange });

		await fillField(dialog().getByLabelText('Title'), 'Fix login');
		await userEvent.keyboard('{Enter}');

		expect(store.all.map((issue) => issue.title)).toEqual(['Fix login']);
		expect(onOpenChange).toHaveBeenCalledWith(false);
		await expect.element(dialog()).not.toBeInTheDocument();
	});

	it('submits from the description with Ctrl+Enter, exactly once', async () => {
		const store = makeStore();
		await render(IssueCreateDialog, { store, open: true });

		await fillField(dialog().getByLabelText('Title'), 'With a body');
		await fillField(dialog().getByLabelText('Description'), 'Steps to reproduce');
		await userEvent.keyboard('{Control>}{Enter}{/Control}');

		// One issue, not two: the handler preventDefaults so Chromium's native implicit
		// submission cannot fire alongside requestSubmit().
		expect(store.all).toHaveLength(1);
		expect(store.all[0]?.description).toBe('Steps to reproduce');
	});

	it('carries the chosen status and priority onto the new issue', async () => {
		const store = makeStore();
		await render(IssueCreateDialog, { store, open: true });

		await fillField(dialog().getByLabelText('Title'), 'Urgent thing');
		await dialog().getByRole('button', { name: 'Status: Backlog' }).click();
		await page.getByRole('menuitemradio', { name: 'Todo' }).click();
		await dialog().getByRole('button', { name: 'Priority: No priority' }).click();
		await page.getByRole('menuitemradio', { name: 'Urgent' }).click();

		await dialog()
			.getByRole('button', { name: /Create issue/ })
			.click();
		expect(store.all[0]?.status).toBe('todo');
		expect(store.all[0]?.priority).toBe('urgent');
	});

	it('refuses a whitespace-only title even via the keyboard shortcut', async () => {
		const store = makeStore();
		await render(IssueCreateDialog, { store, open: true });

		// requestSubmit() bypasses the disabled button, so the handler must check too.
		await fillField(dialog().getByLabelText('Title'), '   ');
		await userEvent.keyboard('{Control>}{Enter}{/Control}');

		expect(store.all).toHaveLength(0);
		await expect.element(dialog()).toBeInTheDocument();
	});

	it('discards a cancelled draft instead of restoring it on the next open', async () => {
		const store = makeStore();
		const result = await render(IssueCreateDialog, { store, open: true });

		await fillField(dialog().getByLabelText('Title'), 'Half-written');
		await userEvent.keyboard('{Escape}');
		await expect.element(dialog()).not.toBeInTheDocument();

		await result.rerender({ store, open: true });
		await expect.element(dialog().getByLabelText('Title')).toHaveValue('');
		expect(store.all).toHaveLength(0);
	});
});
