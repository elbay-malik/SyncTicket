// The invitation to see sync happen.
//
// It used to be a sentence telling the visitor to open "this link" in a second window while
// the address bar showed a bare path — so the one proof the product exists for sat behind a
// copy, a new window and a paste, and the link they would most likely have pasted opened a
// different, empty workspace. These pin the action as real: it opens the share link itself,
// as a peer rather than a child window, and the claim it makes stays on screen beside it.

import { page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { chooseWorkspace, workspaceShareUrl } from '$lib/model/workspace.js';
import SecondWindowInvite from './second-window-invite.svelte';

const WORKSPACE = 'w00000000000000000000000000000001';

afterEach(() => vi.restoreAllMocks());

describe('second-window-invite.svelte', () => {
	it('opens the share link in a new window that cannot reach back into this one', async () => {
		// Stubbed, not let through: a real window.open would leave a stray tab behind in the
		// test browser, and what matters here is the request, not Chromium opening a tab.
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		render(SecondWindowInvite, { workspaceId: WORKSPACE });

		await page.getByRole('button', { name: 'Open a second window' }).click();

		expect(open).toHaveBeenCalledTimes(1);
		const [href, target, features] = open.mock.calls[0]!;
		expect(href).toBe(workspaceShareUrl(location.origin, WORKSPACE));
		// The link a stranger would be sent, so the second window joins through `?ws=` alone and
		// not through anything this browser happens to remember.
		expect(chooseWorkspace(new URL(String(href)).search, null).id).toBe(WORKSPACE);
		expect(target).toBe('_blank');
		expect(String(features).split(',')).toContain('noopener');
	});

	it('keeps the claim the action proves, in the caption register, without becoming an alert', async () => {
		render(SecondWindowInvite, { workspaceId: WORKSPACE });

		const invite = page.getByTestId('second-window-invite');
		await expect.element(invite).toHaveTextContent(/edits merge both ways/i);
		await expect.element(invite).toHaveTextContent('even offline');
		// A standing invitation, not a notice: nothing announces it, and it is not a live region
		// that would read itself out every time the relay reconnects.
		expect(invite.element().closest('[role="status"], [role="alert"], [aria-live]')).toBeNull();
	});
});
