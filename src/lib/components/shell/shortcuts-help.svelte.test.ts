// The help sheet is the one surface that is ABOUT keys, so two things are pinned here:
//
//   - It documents the list's Left/Right walk across a row's pickers. The list owns those keys
//     (issue-list's onKeydown), so the sheet shows them display-only — a registered chord
//     would be a second handler racing the list's own.
//   - Its chips survive on a touch-only device. Kbd hides inline hints there by default, and
//     a sheet of labels with the keys stripped out would explain nothing.

import '../../../routes/layout.css';
import { page } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { shortcuts } from '$lib/keyboard/registry.svelte.js';
import { hiddenOnTouch, touchHiddenSelectors } from '$lib/components/ui/kbd/touch.testing.js';
import ShortcutsHelp from './shortcuts-help.svelte';

let off: (() => void) | undefined;
afterEach(() => off?.());

/** The help sheet's dialog, once open. */
function sheet() {
	return page.getByRole('dialog', { name: 'Keyboard shortcuts' });
}

describe('shortcuts-help.svelte', () => {
	it("documents the within-row walk across a row's pickers", async () => {
		render(ShortcutsHelp, { open: true });
		const row = sheet().getByText("Move across a row's status and priority");
		await expect.element(row).toBeInTheDocument();
		// The label and its keys share a line; the chip is the label's next sibling.
		expect(row.element().nextElementSibling?.textContent).toBe('← →');
	});

	it('does not register the walk with the registry, so the list stays its only handler', async () => {
		render(ShortcutsHelp, { open: true });
		await expect.element(sheet()).toBeInTheDocument();
		const chords = shortcuts.all.map((shortcut) => shortcut.chord.toLowerCase());
		expect(chords.some((chord) => /arrow(left|right)/.test(chord))).toBe(false);
	});

	it('keeps every key chip on a touch-only device', async () => {
		// One registry entry too, so the registry-driven group is covered, not just the
		// hand-listed ones.
		off = shortcuts.register({
			id: 'test-new',
			chord: 'c',
			label: 'New issue',
			group: 'Issues',
			run: () => {}
		});
		render(ShortcutsHelp, { open: true });
		await expect.element(sheet().getByText('New issue')).toBeInTheDocument();

		const chips = [...sheet().element().querySelectorAll('[data-slot="kbd"]')];
		// Every group renders: registry, issue list (4) and board (3).
		expect(chips.length).toBeGreaterThanOrEqual(8);
		// Non-vacuity: the touch-hiding rule exists, so "matches none" is a real answer.
		expect(touchHiddenSelectors().length).toBeGreaterThan(0);
		expect(chips.filter(hiddenOnTouch)).toEqual([]);
	});
});
