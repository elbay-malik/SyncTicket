// The shell's accessibility contract: the landmarks a screen-reader user navigates by, a
// sidebar that contains no dead controls, and reflow at 400% zoom.
//
// All of it is shell, so /issues and /board must agree — the board is the one that used to
// disagree, because its columns scroll horizontally and its column headings are <header>s.
// 320x256 is 1280x1024 magnified 400%, the viewport WCAG 1.4.10 is written against.

import { expect, test, type Page } from './fixtures.js';

/**
 * Waits for hydration before measuring or pressing anything.
 *
 * The presence button is the honest signal: it renders only after mount (who you are is a
 * fact about this browser), so its arrival means the client is live — and it is one of the
 * header items whose width decides whether the header has to wrap.
 */
async function shellReady(page: Page) {
	await expect(page.getByTestId('presence-bar')).toBeVisible();
	await expect(page.getByTestId('share-workspace')).toBeVisible();
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Workspace' });

test('the shell exposes one main, one banner and one navigation landmark', async ({ page }) => {
	await page.goto('/issues');
	await shellReady(page);

	// Sidebar.Inset used to be a <main> of its own with the route layout's <main> inside it,
	// which left "jump to the main content" ambiguous and buried <header> inside a landmark,
	// where it is not exposed as a banner at all.
	await expect(page.locator('main')).toHaveCount(1);
	await expect(page.getByRole('banner')).toHaveCount(1);
	await expect(nav(page)).toBeVisible();
});

test('the board keeps the same landmarks despite its own headers', async ({ page }) => {
	await page.goto('/board');
	await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible();
	await shellReady(page);

	await expect(page.locator('main')).toHaveCount(1);
	// Each column heading is a <header>, but inside a <section>, so none of them is a banner.
	await expect(page.getByRole('banner')).toHaveCount(1);
	await expect(nav(page)).toBeVisible();
});

test('a skip link is the first tab stop and lands focus in main', async ({ page }) => {
	await page.goto('/issues');
	await shellReady(page);

	await page.keyboard.press('Tab');
	const skip = page.getByRole('link', { name: 'Skip to content' });
	await expect(skip).toBeFocused();

	await skip.press('Enter');
	// SvelteKit sets the focus navigation starting point in a setTimeout, and the target's
	// tabindex="-1" is what turns that into real focus rather than a scroll.
	await expect(page.locator('main')).toBeFocused();
});

test('every control in the sidebar navigation can actually be activated', async ({ page }) => {
	await page.goto('/issues');
	await shellReady(page);

	// The "Search — Phase 8" entry was focusable, aria-disabled and inert: the third stop in
	// the tab order, doing nothing on Enter. Nothing in here may be disabled-but-focusable.
	await expect(nav(page).locator('[aria-disabled="true"]')).toHaveCount(0);

	const search = nav(page).getByRole('button', { name: 'Search' });
	// The chord hint is aria-hidden, so the accessible name is exactly "Search".
	await expect(search).toHaveAccessibleName('Search');

	await search.press('Enter');
	await expect(page.getByPlaceholder('Search issues or run a command…')).toBeVisible();
});

test('Search closes the phone sidebar before opening the palette', async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 256 });
	await page.goto('/issues');
	await shellReady(page);

	// Below md the sidebar *is* a Sheet, so this is a dialog opening from inside a dialog.
	await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
	await nav(page).getByRole('button', { name: 'Search' }).press('Enter');

	await expect(page.getByPlaceholder('Search issues or run a command…')).toBeVisible();
	await expect(nav(page)).toHaveCount(0);
});

for (const path of ['/issues', '/board']) {
	test(`${path} reflows at 320px without a horizontal scrollbar`, async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 256 });
		await page.goto(path);
		await shellReady(page);

		const doc = await page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth
		}));
		// The header's trailing group was ~10px too wide for one 320px line, and nothing in it
		// was allowed to wrap. The board's own columns still scroll — inside <main>, which is
		// exactly where a 1.4.10 exception for a two-dimensional layout belongs.
		expect(doc).toEqual({ scrollWidth: 320, clientWidth: 320 });
	});
}
