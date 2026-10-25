// Whether an inline key hint disappears on a touch-only device, and a reference one does not.
//
// Asserted on the generated stylesheet (see touch.testing.ts for why), which catches the two
// ways this goes quietly wrong: an arbitrary variant Tailwind does not parse — no rule is
// generated, while the class string still looks right — and an opt-out that does not opt out.

import '../../../../routes/layout.css';
import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import Kbd from './kbd.svelte';
import { hiddenOnTouch, touchHiddenSelectors } from './touch.testing.js';

const label = (text: string) => createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));

describe('kbd.svelte', () => {
	it('hides an inline hint on a touch-only device', async () => {
		render(Kbd, { children: label('C'), 'data-testid': 'hint' });
		const chip = page.getByTestId('hint');
		await expect.element(chip).toBeInTheDocument();
		// Non-vacuity: the rule exists at all, so "not matched" below means something.
		expect(touchHiddenSelectors().length).toBeGreaterThan(0);
		expect(hiddenOnTouch(chip.element())).toBe(true);
		// And only there: on this (fine-pointer) test browser it still shows.
		expect(getComputedStyle(chip.element()).display).toBe('inline-flex');
	});

	it('keeps a reference chip that opts out with showOnTouch', async () => {
		render(Kbd, { children: label('C'), showOnTouch: true, 'data-testid': 'reference' });
		const chip = page.getByTestId('reference');
		await expect.element(chip).toBeInTheDocument();
		expect(touchHiddenSelectors().length).toBeGreaterThan(0);
		expect(hiddenOnTouch(chip.element())).toBe(false);
	});

	it('never wraps a chord onto two lines when squeezed', async () => {
		// The shortcuts sheet at 390px: a long label beside "← →" crushed the chip until the
		// two arrows stacked. A flex row the width of nothing is the worst case of that.
		const host = document.createElement('div');
		host.style.cssText = 'display: flex; width: 0';
		document.body.appendChild(host);
		render(Kbd, { target: host, props: { children: label('← →'), 'data-testid': 'chord' } });
		const chip = page.getByTestId('chord');
		await expect.element(chip).toBeInTheDocument();
		// The chip keeps the chord's full one-line width rather than being crushed to `min-w-5`
		// (20px) with the arrows spilling out of, or stacking inside, its fill.
		const chord = chip.element().firstElementChild as HTMLElement;
		const chipBox = chip.element().getBoundingClientRect();
		expect(chipBox.width).toBeGreaterThan(20);
		expect(chipBox.width).toBeGreaterThanOrEqual(chord.getBoundingClientRect().width);
		expect(chord.getBoundingClientRect().height).toBeLessThanOrEqual(chipBox.height);
		host.remove();
	});
});
