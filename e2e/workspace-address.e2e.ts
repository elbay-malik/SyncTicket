// The address bar is the workspace link.
//
// It used not to be: internal links carry no `?ws=` and the id lived in this browser's storage,
// so after the first click the address bar showed a bare `/issues`. An evaluator who copied it
// to a phone — the most natural way to try a sync demo — opened a fresh, empty workspace and
// concluded that sync was broken. The root layout now writes the id back after every
// navigation; these pin that from a visitor's side: what the bar says, what Back does, what a
// reload and a copied link do, and what happens to a link that was wrong.

import { expect, onRoute, test, type Browser, type Page } from './fixtures.js';
import { WORKSPACE_STORAGE_KEY } from '../src/lib/model/workspace.js';

/** The exact address `path` should end up at in `workspaceId`. */
const exactly = (path: string, workspaceId: string) => new RegExp(`${path}\\?ws=${workspaceId}$`);

/** Which workspace this page's browser has remembered. */
const remembered = (page: Page) =>
	page.evaluate((key) => window.localStorage.getItem(key), WORKSPACE_STORAGE_KEY);

/** A browser with nothing in it: no remembered workspace, no fixture. A real first visit. */
async function freshPage(browser: Browser): Promise<Page> {
	const context = await browser.newContext();
	return context.newPage();
}

test('a first visit ends with its own workspace in the address bar', async ({ browser }) => {
	const page = await freshPage(browser);
	await page.goto('/issues');
	await expect(page.getByText('No issues yet')).toBeVisible();

	// Minted, remembered, and shown — the same id in all three places.
	await expect(page).toHaveURL(/\/issues\?ws=w[0-9a-f]{32}$/);
	const id = new URL(page.url()).searchParams.get('ws');
	expect(await remembered(page)).toBe(id);

	// Rewritten in place, not pushed: Back leaves the app rather than walking into a bare
	// `/issues` twin of this entry.
	await page.goBack();
	expect(page.url()).not.toMatch(/\/issues/);

	await page.context().close();
});

test('the workspace stays in the address bar across /issues, /board and an issue', async ({
	page,
	workspaceId
}) => {
	await page.goto('/issues');
	await expect(page).toHaveURL(exactly('/issues', workspaceId));
	const input = page.getByPlaceholder('Add an issue and press Enter…');
	await input.fill('Follow me around');
	await input.press('Enter');
	await expect(page.getByRole('link', { name: 'Follow me around' })).toBeVisible();
	const entries = await page.evaluate(() => history.length);

	// Internal links carry no `?ws=`; each landing gets it back.
	await page.getByRole('link', { name: 'Board', exact: true }).click();
	await expect(page).toHaveURL(exactly('/board', workspaceId));
	await page.getByRole('list', { name: 'Backlog' }).getByRole('listitem').first().click();
	await expect(page).toHaveURL(exactly('/issues/[0-9a-f-]{36}', workspaceId));
	await expect(page.getByRole('dialog').getByLabel('Title')).toHaveValue('Follow me around');

	// One history entry per navigation, not two: the rewrite replaces the bare landing.
	expect(await page.evaluate(() => history.length)).toBe(entries + 2);

	// Closing the sheet replaces its entry, and lands on the list with the id still there.
	await page.keyboard.press('Escape');
	await expect(page).toHaveURL(exactly('/issues', workspaceId));

	// And Back walks into an address that carries it too, never a bare twin.
	await page.goBack();
	await expect(page).toHaveURL(exactly('/board', workspaceId));
});

test('a reload stays in the same workspace', async ({ page, workspaceId }) => {
	await page.goto('/issues');
	// Hydrated before typing, as issues.e2e.ts waits too: a field filled from the server-rendered
	// HTML holds the text, but its Add button is still the disabled one the server drew, so
	// Enter submits nothing and the issue is never made.
	await expect(page.getByText('No issues yet')).toBeVisible();
	const input = page.getByPlaceholder('Add an issue and press Enter…');
	await input.fill('Still here');
	await input.press('Enter');
	await expect(page.getByRole('link', { name: 'Still here' })).toBeVisible();
	await expect(page).toHaveURL(exactly('/issues', workspaceId));

	await page.reload();
	await expect(page).toHaveURL(exactly('/issues', workspaceId));
	await expect(page.getByRole('link', { name: 'Still here' })).toBeVisible();
});

test('copying the address bar into another browser joins the same workspace', async ({
	browser
}) => {
	// Two untouched browsers and nothing between them but the copied address — exactly what an
	// evaluator does with a laptop and a phone. Navigated first, so the copy is taken from an
	// address the app rewrote, not the one it was loaded with.
	const alice = await freshPage(browser);
	await alice.goto('/issues');
	await expect(alice.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 30_000
	});
	const input = alice.getByPlaceholder('Add an issue and press Enter…');
	await input.fill('Seen on the phone');
	await input.press('Enter');
	await alice.getByRole('link', { name: 'Board', exact: true }).click();
	await expect(alice).toHaveURL(onRoute('/board'));
	const copied = await alice.evaluate(() => location.href);

	const bob = await freshPage(browser);
	await bob.goto(copied);
	await expect(bob.getByText('Seen on the phone')).toBeVisible({ timeout: 30_000 });
	expect(await remembered(bob)).toBe(await remembered(alice));
	await expect(bob).toHaveURL(copied);

	await alice.context().close();
	await bob.context().close();
});

test('a bad workspace link is replaced by the real one, says so once, and keeps the sheet open', async ({
	page,
	workspaceId
}) => {
	await page.goto('/issues');
	await expect(page.getByText('No issues yet')).toBeVisible();
	const input = page.getByPlaceholder('Add an issue and press Enter…');
	await input.fill('Deep link target');
	await input.press('Enter');
	await page.getByRole('link', { name: 'Deep link target' }).click();
	await expect(page).toHaveURL(exactly('/issues/[0-9a-f-]{36}', workspaceId));
	const issuePath = new URL(page.url()).pathname;

	// A cold load of that issue with a broken id — a mangled share link.
	await page.goto(`${issuePath}?ws=not%20a%20valid%20id!`);

	// The fallback is this browser's own workspace, and the address now says so, path intact.
	await expect(page).toHaveURL(exactly(issuePath, workspaceId));
	await expect(page.getByRole('dialog').getByLabel('Title')).toHaveValue('Deep link target');
	const notice = page.getByTestId('invalid-workspace-link');
	await expect(notice).toHaveCount(1);
	await expect(notice).toContainText('not a valid id!');

	// Closing the sheet is a navigation like any other: the notice is not shown a second time,
	// and the address keeps the real id.
	await page.keyboard.press('Escape');
	await expect(page).toHaveURL(exactly('/issues', workspaceId));
	await expect(notice).toHaveCount(1);
});

test('the root redirect keeps a workspace link', async ({ browser }) => {
	const page = await freshPage(browser);
	const id = `t${crypto.randomUUID().replace(/-/g, '')}`;
	await page.goto(`/?ws=${id}`);
	await expect(page).toHaveURL(exactly('/issues', id));
	// The redirect is the server's, so the address is right before any client code has run;
	// remembering the id is the client's job, done once it has hydrated.
	await expect(page.getByText('No issues yet')).toBeVisible();
	expect(await remembered(page)).toBe(id);
	await page.context().close();
});

test('the empty state makes loading examples the one primary action', async ({ page }) => {
	await page.goto('/issues');
	const load = page.getByRole('button', { name: 'Load example issues' });
	const create = page.getByRole('button', { name: /New issue/ });
	await expect(load).toBeVisible();

	// One solid Ink button per surface (DESIGN.md): while seeding is on offer it is that
	// button, and "New issue" steps down rather than competing for the first click.
	const fill = (locator: typeof load) =>
		locator.evaluate((element) => getComputedStyle(element).backgroundColor);
	const primary = await fill(load);
	expect(await fill(create)).not.toBe(primary);

	await load.click();
	await expect(page.getByText('No issues yet')).toBeHidden();
	// And hands it back once there is a list.
	await expect.poll(() => fill(create)).toBe(primary);
});

test('the second-window invitation opens this workspace as a peer, and leaves when it arrives', async ({
	page,
	workspaceId
}) => {
	await page.goto('/issues');
	const invitation = page.getByTestId('second-window-invite');
	await expect(invitation).toBeVisible({ timeout: 30_000 });

	const [second] = await Promise.all([
		page.context().waitForEvent('page'),
		invitation.getByRole('button', { name: 'Open a second window' }).click()
	]);
	await expect(second).toHaveURL(exactly('/issues', workspaceId));
	// No handle back: the new window is a peer, not something the first can script.
	expect(await second.evaluate(() => window.opener)).toBeNull();

	// The second window arriving is the proof, and so the dismissal, on both sides.
	await expect(invitation).toBeHidden({ timeout: 15_000 });
	await expect(second.getByTestId('second-window-invite')).toBeHidden();
	await second.close();
});
