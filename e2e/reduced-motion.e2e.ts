// The one part of the reduced-motion contract that only a browser can check.
//
// `layout.css`'s `@media (prefers-reduced-motion: reduce)` block makes claims that were true by
// inspection when written and were asserted nowhere: that an unlayered `!important` outranks
// Tailwind's layered utilities, and that cutting an animation to 0.01ms does not strand a
// bits-ui dialog half-closed. The second is the one with teeth — it was verified by reading
// bits-ui's `animations-complete.js`, which waits on `getAnimations()` and `Animation.finished`
// rather than an `animationend` event, and both Svelte and bits-ui have moved versions since. A
// dialog that never unmounts leaves a modal overlay over the whole app, which is not a
// degradation anyone would call "less motion".
//
// The JS half of the contract — `animate:flip` and Svelte transitions, which run through
// `element.animate()` and ignore CSS durations entirely — is a pure function asserted in
// `src/lib/components/issues/board-drag.test.ts`. It cannot be checked here and is not.
//
// WHY `page.emulateMedia` AND NOT `test.use({ reducedMotion })`, which is the documented way:
// the option does nothing here. Measured with Playwright 1.61.1 and this config, set at module
// scope, at describe scope, with and without this repo's `context` fixture, and on a freshly
// opened page from the same context — `matchMedia('(prefers-reduced-motion: reduce)').matches`
// is `false` in every case, while `page.emulateMedia({ reducedMotion: 'reduce' })` makes it
// `true` immediately. A test written the documented way therefore passes by asserting nothing,
// which is worse than having no test: the first draft of this file did exactly that, and only
// failed because the app's real duration (0.1s) happened to contradict the expectation.
//
// The second draft then read the computed string and compared it to `'0.01ms'`, which fails
// against a working stylesheet because Chromium serialises that value as `"1e-05s"` — and
// briefly looked like a cascade bug in `layout.css`. Hence the numeric comparison below.
//
// Hence `setMotion` asserts the emulation took hold before anything else runs. That line is not
// a formality; it is the only thing standing between this file and silently testing the
// default preference twice.

import { expect, test } from './fixtures.js';
import type { Page } from './fixtures.js';

/** Applies a motion preference and proves it applied, so no assertion below can be vacuous. */
async function setMotion(page: Page, preference: 'reduce' | 'no-preference') {
	await page.emulateMedia({ reducedMotion: preference });
	await expect
		.poll(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches))
		.toBe(preference === 'reduce');
}

/**
 * The resolved animation duration, in seconds, as a NUMBER.
 *
 * Not the computed string: Chromium serialises 0.01ms as `"1e-05s"`, so comparing against
 * `'0.01ms'` fails while the stylesheet is working perfectly — which is exactly what the second
 * draft of this file concluded was a cascade bug. Computed style rather than
 * `element.getAnimations()`, because under `reduce` a 0.01ms animation has usually already
 * finished and dropped off the element by the time it can be read.
 */
function animationSeconds(dialog: ReturnType<Page['getByRole']>): Promise<number> {
	return dialog.evaluate((el) => Number.parseFloat(getComputedStyle(el).animationDuration));
}

/** Opens the create dialog the way the keyboard tests do: the shortcut needs hydration. */
async function openCreateDialog(page: Page) {
	await expect(page.getByText('No issues yet')).toBeVisible();
	await expect(async () => {
		await page.keyboard.press('c');
		await expect(page.getByRole('dialog', { name: 'New issue' })).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 15_000 });
	return page.getByRole('dialog', { name: 'New issue' });
}

test('reduce cuts the animation and the dialog still unmounts', async ({ page }) => {
	await page.goto('/issues');
	await setMotion(page, 'reduce');
	const dialog = await openCreateDialog(page);

	// The cascade claim: `data-open:animate-in` with `duration-100` is a layered utility, and
	// the block overriding it is unlayered `!important`. If a future Tailwind moves its
	// utilities out of `@layer utilities`, this is what notices.
	// 0.01ms, expressed as seconds. Asserted as "indistinguishable from instant" rather than as
	// an exact figure, so retuning the block from 0.01ms to 1ms does not fail this.
	await expect.poll(() => animationSeconds(dialog)).toBeLessThan(0.001);

	// The claim with teeth. Escape starts bits-ui's close sequence, which waits on an animation
	// it has been told lasts 0.01ms. "Hidden" means gone from the accessibility tree, not merely
	// transparent — a stranded overlay would keep the dialog present.
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();

	// And the app underneath is usable again rather than sitting behind a dead overlay.
	await expect(page.getByText('No issues yet')).toBeVisible();
	await page.keyboard.press('c');
	await expect(page.getByRole('dialog', { name: 'New issue' })).toBeVisible();
});

test('no-preference leaves the designed duration, and also unmounts', async ({ page }) => {
	// The control. Without it, the test above would pass just as well against a stylesheet that
	// shortened this animation unconditionally, which would say nothing about the media query.
	await page.goto('/issues');
	await setMotion(page, 'no-preference');
	const dialog = await openCreateDialog(page);

	// The component's own `duration-100`, untouched: three orders of magnitude away from the
	// reduce case, which is the gap that makes the assertion above meaningful.
	await expect.poll(() => animationSeconds(dialog)).toBeCloseTo(0.1, 3);

	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
});
