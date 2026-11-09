// The "Try this" card and the one thing it stores.
//
// The card is how a visitor in a hurry finds sync and offline editing, so these pin when it
// appears, that both ways out work and only one is remembered, that it can be brought back,
// and that it never takes the page's keys or focus without being asked to.

import { page, userEvent } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { workspaceShareUrl } from '$lib/model/workspace.js';
import {
	ANSWER_WAIT_MS,
	GUIDE_KEY,
	closeGuide,
	guide,
	guideDismissed,
	showGuide,
	startGuide as startGuideNow,
	stopGuide
} from '$lib/state/guide.svelte.js';
import FirstVisitGuide from './first-visit-guide.svelte';

const card = () => page.getByRole('complementary', { name: 'Try this' });

const WORKSPACE = 'w00000000000000000000000000000001';
const PROPS = {
	ready: true,
	empty: false,
	paletteHint: '⌘K',
	workspaceId: WORKSPACE,
	onLoadExamples: () => {}
};

/** Starts the guide and waits out its question to other windows. */
async function startGuide() {
	startGuideNow();
	await new Promise((resolve) => setTimeout(resolve, ANSWER_WAIT_MS + 50));
}

beforeEach(async () => {
	// Wide enough for the card's always-open layout; the phone's collapsed one has its own test.
	await page.viewport(1024, 768);
	localStorage.removeItem(GUIDE_KEY);
	closeGuide();
	guide.focusOnOpen = false;
});
afterEach(() => {
	stopGuide();
	vi.restoreAllMocks();
});

describe('first-visit guide state', () => {
	it('opens on a first visit when no other window answers', async () => {
		await startGuide();
		expect(guide.open).toBe(true);
	});

	it('stays closed in a window opened beside one already showing the app', async () => {
		const other = new BroadcastChannel('syncticket-guide');
		other.onmessage = (event) => {
			if (event.data === 'anyone') other.postMessage('here');
		};
		try {
			await startGuide();
			expect(guide.open).toBe(false);
		} finally {
			other.close();
		}
	});

	it('answers a window opened after it, so that one stays closed', async () => {
		await startGuide();
		const replies: unknown[] = [];
		const later = new BroadcastChannel('syncticket-guide');
		later.onmessage = (event) => replies.push(event.data);
		later.postMessage('anyone');
		await expect.poll(() => replies).toContain('here');
		later.close();
	});

	it('stays closed once dismissed, under a versioned key', async () => {
		localStorage.setItem(GUIDE_KEY, 'dismissed');
		await startGuide();
		expect(guide.open).toBe(false);
		expect(GUIDE_KEY).toBe('guide:syncticket:v1');
	});

	it('still shows, and closes, when the browser refuses storage', async () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new DOMException('blocked', 'SecurityError');
		});
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('blocked', 'SecurityError');
		});
		expect(guideDismissed()).toBe(false);
		await startGuide();
		expect(guide.open).toBe(true);
	});
});

describe('first-visit-guide.svelte', () => {
	it('shows the three steps, starting with the examples in an empty workspace', async () => {
		await startGuide();
		render(FirstVisitGuide, { ...PROPS, empty: true });

		await expect.element(card()).toBeVisible();
		const steps = card().getByRole('listitem');
		await expect
			.element(steps.nth(0))
			.toHaveTextContent(
				/^See it sync\. Change an issue in one window.*Load example issues\s*Open a second window$/
			);
		await expect.element(steps.nth(1)).toHaveTextContent(/Go offline/);
		await expect.element(steps.nth(1)).not.toHaveTextContent(/reload/i);
		await expect
			.element(steps.nth(2))
			.toHaveTextContent(/^Search with ⌘K, or from Search in the sidebar\./);
		await expect.element(card()).toHaveTextContent(/briefly refused/);
		// Not a dialog and not an announcement: it stands beside the demo.
		expect(card().element().closest('[role="dialog"], [aria-live], [role="status"]')).toBeNull();
		// Appeared on its own, so it did not take focus.
		expect(card().element().contains(document.activeElement)).toBe(false);
	});

	it('leaves the examples out once there are issues', async () => {
		await startGuide();
		render(FirstVisitGuide, { ...PROPS, paletteHint: 'Ctrl+K' });

		await expect
			.element(card().getByRole('listitem').nth(0))
			.toHaveTextContent(/^See it sync\..*second\.\s*Open a second window$/);
		await expect.element(card()).toHaveTextContent('Search with Ctrl+K, or from Search');
	});

	it('closes for this visit without remembering it', async () => {
		await startGuide();
		render(FirstVisitGuide, { ...PROPS });

		await page.getByRole('button', { name: 'Close', exact: true }).click();
		await expect.element(card()).not.toBeInTheDocument();
		expect(localStorage.getItem(GUIDE_KEY)).toBeNull();

		await startGuide();
		await expect.element(card()).toBeVisible();
	});

	it('the corner X closes it the same way', async () => {
		await startGuide();
		render(FirstVisitGuide, { ...PROPS });

		await page.getByRole('button', { name: 'Close the guide' }).click();
		await expect.element(card()).not.toBeInTheDocument();
		expect(localStorage.getItem(GUIDE_KEY)).toBeNull();
	});

	it("remembers Don't show again, and can still be reopened", async () => {
		await startGuide();
		render(FirstVisitGuide, { ...PROPS });

		await page.getByRole('button', { name: "Don't show again" }).click();
		await expect.element(card()).not.toBeInTheDocument();
		expect(localStorage.getItem(GUIDE_KEY)).toBe('dismissed');

		await startGuide();
		await expect.element(card()).not.toBeInTheDocument();

		showGuide();
		await expect.element(card()).toBeVisible();
		// Asked for, so it takes focus.
		await expect.poll(() => card().element() === document.activeElement).toBe(true);
	});

	it('closes on Esc from inside, and leaves Esc alone elsewhere', async () => {
		await startGuide();
		render(FirstVisitGuide, { ...PROPS });

		const outside = document.createElement('button');
		outside.textContent = 'outside';
		document.body.appendChild(outside);
		outside.focus();
		await userEvent.keyboard('{Escape}');
		await expect.element(card()).toBeVisible();
		outside.remove();

		await page.getByRole('button', { name: 'Close', exact: true }).element().focus();
		await userEvent.keyboard('{Escape}');
		await expect.element(card()).not.toBeInTheDocument();
	});

	it('waits for the workspace to settle, so step one never rewrites itself', async () => {
		await startGuide();
		const view = render(FirstVisitGuide, { ...PROPS, ready: false, empty: true });
		await expect.element(card()).not.toBeInTheDocument();
		await view.rerender({ ready: true });
		await expect.element(card()).toBeVisible();
	});

	it('does what step one says from any page: loads the examples and opens the share link', async () => {
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		const onLoadExamples = vi.fn();
		await startGuide();
		render(FirstVisitGuide, { ...PROPS, empty: true, onLoadExamples });

		await card().getByRole('button', { name: 'Load example issues' }).click();
		expect(onLoadExamples).toHaveBeenCalledTimes(1);
		await card().getByRole('button', { name: 'Open a second window' }).click();
		expect(open).toHaveBeenCalledWith(
			workspaceShareUrl(location.origin, WORKSPACE),
			'_blank',
			'noopener'
		);
	});

	it('starts as one line on a phone, and opens on Show', async () => {
		await page.viewport(360, 740);
		await startGuide();
		render(FirstVisitGuide, { ...PROPS, empty: true });

		const show = card().getByRole('button', { name: 'Show', exact: true });
		await expect.element(show).toHaveAttribute('aria-expanded', 'false');
		const body = () => document.getElementById('first-visit-guide-body')!;
		expect(body().classList.contains('hidden')).toBe(true);
		await show.click();
		await expect.poll(() => body().classList.contains('hidden')).toBe(false);
		await expect
			.element(card().getByRole('button', { name: 'Hide', exact: true }))
			.toHaveAttribute('aria-expanded', 'true');
	});
});
