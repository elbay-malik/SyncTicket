// What Share does when the browser refuses the clipboard.
//
// The failure path used to announce that "the invite link is on the Share button as a
// tooltip" while the button's title was a fixed sentence with no link in it — a recovery hint
// pointing at nothing, on the one control that starts the product's whole demo. These pin the
// recovery as real: the link itself, in a field, selected, with focus already on it, and an
// announcement that describes exactly that.

import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { workspaceShareUrl } from '$lib/model/workspace.js';
import type { IssueStore } from '$lib/state/issues.svelte.js';
import ShareWorkspace from './share-workspace.svelte';

/** The only field the component reads. A real IssueStore would attach IndexedDB and a relay. */
const store = { workspaceId: 'ws-test-1234' } as unknown as IssueStore;
const url = () => workspaceShareUrl(location.origin, 'ws-test-1234');

afterEach(() => vi.restoreAllMocks());

describe('share-workspace.svelte', () => {
	it('hands over the link itself, selected and focused, when the clipboard is refused', async () => {
		vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
			new DOMException('Write permission denied.', 'NotAllowedError')
		);
		render(ShareWorkspace, { store });

		const button = page.getByTestId('share-workspace');
		await button.click();

		const field = page.getByRole('textbox', { name: 'Invite link' });
		await expect.element(field).toHaveValue(url());
		await expect.element(field).toHaveAttribute('readonly');
		await expect.element(field).toHaveFocus();
		const input = field.element() as HTMLInputElement;
		expect([input.selectionStart, input.selectionEnd]).toEqual([0, url().length]);

		// The hover hint is the link too, rather than the generic sentence.
		await expect.element(button).toHaveAttribute('title', url());
		await expect.element(button).toHaveTextContent('Copy failed');
		// And the announcement points at what is actually on screen, not at a tooltip.
		await expect
			.element(page.getByRole('status'))
			.toHaveTextContent(
				'Copy failed. The invite link is selected in a text field, ready to copy.'
			);
	});

	it('returns focus to Share and clears the failure when the fallback is dismissed', async () => {
		vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
		render(ShareWorkspace, { store });

		const button = page.getByTestId('share-workspace');
		await button.click();
		await expect.element(page.getByTestId('share-fallback-url')).toHaveFocus();

		await userEvent.keyboard('{Escape}');
		await expect.element(page.getByTestId('share-fallback')).not.toBeInTheDocument();
		await expect.element(button).toHaveFocus();
		await expect.element(button).toHaveTextContent('Share');
		await expect.element(button).toHaveAttribute('title', 'Copy an invite link to this workspace');
		await expect.element(page.getByRole('status')).toHaveTextContent('');
	});

	it('leaves focus where a click outside put it, rather than pulling it back to Share', async () => {
		vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
		// Stands in for the quick-add field: a click there both dismisses the fallback and is a
		// request to type there, and keys that land on Share instead fire global shortcuts.
		const elsewhere = document.createElement('input');
		elsewhere.setAttribute('aria-label', 'Elsewhere');
		document.body.appendChild(elsewhere);
		try {
			render(ShareWorkspace, { store });
			await page.getByTestId('share-workspace').click();
			await expect.element(page.getByTestId('share-fallback-url')).toHaveFocus();

			await page.getByRole('textbox', { name: 'Elsewhere' }).click();
			await expect.element(page.getByTestId('share-fallback')).not.toBeInTheDocument();
			// Past the point any deferred focus restoration would have run.
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(document.activeElement).toBe(elsewhere);
		} finally {
			elsewhere.remove();
		}
	});

	it('copies and opens nothing when the clipboard accepts', async () => {
		const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
		render(ShareWorkspace, { store });

		const button = page.getByTestId('share-workspace');
		await button.click();
		await expect.element(button).toHaveTextContent('Copied');
		expect(write).toHaveBeenCalledWith(url());
		expect(page.getByTestId('share-fallback').query()).toBeNull();
	});
});
