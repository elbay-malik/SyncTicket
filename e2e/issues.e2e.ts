import {
	committedUpdates,
	expect,
	onRoute,
	test,
	waitForCommitAbove,
	type Page
} from './fixtures.js';

/** Any well-formed id that cannot exist, used to warm the detail route. */
const ABSENT_ID = '00000000-0000-4000-8000-000000000000';

/**
 * Visits the detail route once so its lazily-imported chunk is in the module map. Without
 * this, the first navigation to /issues/[id] after going offline has no code to fetch and
 * lands on an error page — the app preloads it on mount, but a test must not race that.
 */
async function warmDetailRoute(page: Page) {
	await page.goto(`/issues/${ABSENT_ID}`);
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.getByRole('button', { name: 'Back to issues' }).click();
	await expect(page).toHaveURL(onRoute('/issues'));
}

test('quick-add creates an issue that persists across a reload', async ({ page, workspaceDb }) => {
	await page.goto('/issues');
	// Empty state implies the store has finished its initial IndexedDB sync, so the
	// baseline update count is stable.
	await expect(page.getByText('No issues yet')).toBeVisible();
	const baseline = await committedUpdates(page, workspaceDb);

	const input = page.getByPlaceholder('Add an issue…');
	await input.fill('Persisted issue');
	await input.press('Enter');
	await expect(page.getByRole('listitem').filter({ hasText: 'Persisted issue' })).toBeVisible();

	await waitForCommitAbove(page, workspaceDb, baseline);

	// A hard reload re-hydrates from IndexedDB — the issue must reappear.
	await page.reload();
	await expect(page.getByRole('listitem').filter({ hasText: 'Persisted issue' })).toBeVisible();
});

test('status filter narrows the list via the derived query index', async ({ page }) => {
	await page.goto('/issues');
	// Wait for the empty state before typing: it means the client has hydrated and the store
	// has finished its IndexedDB sync. Filling the field earlier sets the DOM value before
	// Svelte's binding exists, so the draft stays empty and Enter submits nothing.
	await expect(page.getByText('No issues yet')).toBeVisible();

	const input = page.getByPlaceholder('Add an issue…');
	await input.fill('Backlog task');
	await input.press('Enter');
	await expect(page.getByRole('listitem').filter({ hasText: 'Backlog task' })).toBeVisible();

	// New issues default to Backlog, so filtering to Done should hide it.
	await page.getByRole('button', { name: 'All issues' }).click();
	await page.getByRole('menuitem', { name: 'Done' }).click();
	await expect(page.getByRole('listitem').filter({ hasText: 'Backlog task' })).toHaveCount(0);
	await expect(page.getByText('No matching issues')).toBeVisible();
});

test('full CRUD works offline and the result survives a reload', async ({
	page,
	context,
	workspaceDb
}) => {
	await page.goto('/issues');
	await expect(page.getByText('No issues yet')).toBeVisible();
	await warmDetailRoute(page);
	await expect(page.getByText('No issues yet')).toBeVisible();

	// Everything from here happens with no network at all.
	await context.setOffline(true);

	// CREATE — via the keyboard, through the dialog. The shortcut only exists once Svelte
	// has hydrated, so retry it the way the ⌘K test does.
	await expect(async () => {
		await page.keyboard.press('c');
		await expect(page.getByRole('dialog', { name: 'New issue' })).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 15_000 });

	const dialog = page.getByRole('dialog', { name: 'New issue' });
	// Wait for the dialog's own autofocus to have landed before typing into it, which is a
	// real race and not a formality. `fill()` is `.focus()` followed by
	// `keyboard.insertText()`, and insertText goes to whatever holds focus at that instant —
	// so if bits-ui's focus scope is still pending when the dialog becomes visible, filling
	// Title and then Description reads: focus Title, insert, focus Description, *autofocus
	// fires and pulls focus back to Title*, insert again. Both strings land in Title, and the
	// issue is created titled "Offline issueWritten with the network off". Reproduced at
	// roughly 1 run in 6 under `--repeat-each`, and it is what broke CI, which runs one worker
	// on slower hardware.
	await expect(dialog.getByLabel('Title')).toBeFocused();
	await dialog.getByLabel('Title').fill('Offline issue');
	await dialog.getByLabel('Description').fill('Written with the network off');
	await page.keyboard.press('ControlOrMeta+Enter');
	await expect(dialog).toBeHidden();
	await expect(page.getByRole('link', { name: 'Offline issue' })).toBeVisible();

	// READ — open the detail sheet at its own URL.
	await page.getByRole('link', { name: 'Offline issue' }).click();
	await expect(page).toHaveURL(onRoute('/issues/[0-9a-f-]{36}'));
	const sheet = page.getByRole('dialog');
	await expect(sheet.getByLabel('Title')).toHaveValue('Offline issue');

	// UPDATE — status through the picker, and the title inline.
	await sheet.getByRole('button', { name: 'Status: Backlog' }).click();
	await page.getByRole('menuitemradio', { name: 'In Progress' }).click();
	await expect(sheet.getByRole('button', { name: 'Status: In Progress' })).toBeVisible();

	await sheet.getByLabel('Title').fill('Offline issue, renamed');
	await sheet.getByLabel('Title').press('Enter');

	// The list behind the sheet is a projection of the same CRDT, so it already agrees.
	await expect(page.getByRole('link', { name: 'Offline issue, renamed' })).toBeVisible();
	await expect(
		page.getByRole('listitem').getByRole('button', { name: 'Status: In Progress' })
	).toBeVisible();

	// DELETE — behind a confirmation.
	await sheet.getByRole('button', { name: 'Delete' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Delete issue' }).click();
	await expect(page).toHaveURL(onRoute('/issues'));
	await expect(page.getByRole('link', { name: 'Offline issue, renamed' })).toHaveCount(0);

	// One more issue, so the reload has something to prove.
	const baseline = await committedUpdates(page, workspaceDb);
	const input = page.getByPlaceholder('Add an issue…');
	await input.fill('Survivor');
	await input.press('Enter');
	await expect(page.getByRole('link', { name: 'Survivor' })).toBeVisible();

	// Reloading needs the network back; the writes above were already local-only.
	await context.setOffline(false);
	await waitForCommitAbove(page, workspaceDb, baseline);
	await page.reload();

	await expect(page.getByRole('link', { name: 'Survivor' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Offline issue, renamed' })).toHaveCount(0);
});

test('a detail sheet URL can be shared and reloaded', async ({ page, workspaceDb }) => {
	await page.goto('/issues');
	await expect(page.getByText('No issues yet')).toBeVisible();
	const baseline = await committedUpdates(page, workspaceDb);

	const input = page.getByPlaceholder('Add an issue…');
	await input.fill('Deep linked');
	await input.press('Enter');
	await page.getByRole('link', { name: 'Deep linked' }).click();
	await expect(page.getByRole('dialog').getByLabel('Title')).toHaveValue('Deep linked');

	// Waited for rather than read straight off: the workspace's `?ws=` is put back just after the
	// navigation lands, and it is that address — the one a visitor would copy — being reloaded.
	await expect(page).toHaveURL(onRoute('/issues/[0-9a-f-]{36}'));
	const url = page.url();
	await waitForCommitAbove(page, workspaceDb, baseline);

	// Loading the URL cold must rebuild the same view from IndexedDB alone.
	await page.goto(url);
	await expect(page.getByRole('dialog').getByLabel('Title')).toHaveValue('Deep linked');

	// Escape closes it and returns to the list.
	await page.keyboard.press('Escape');
	await expect(page).toHaveURL(onRoute('/issues'));
	await expect(page.getByRole('link', { name: 'Deep linked' })).toBeVisible();
});

test('the empty state can seed itself with example issues, on request only', async ({
	page,
	workspaceDb
}) => {
	await page.goto('/issues');
	await expect(page.getByText('No issues yet')).toBeVisible();
	const baseline = await committedUpdates(page, workspaceDb);

	await page.getByRole('button', { name: 'Load example issues' }).click();
	await expect(page.getByText('No issues yet')).toHaveCount(0);
	await expect(page.getByRole('link', { name: /Board column drag is broken/ })).toBeVisible();
	// The list is virtualized, so a DOM count is only ever "how many fit in the viewport" —
	// what actually matters is that reloading renders exactly as many, proving the seeded
	// issues are real, persisted data rather than a one-off view.
	const rowCount = await page.getByRole('listitem').count();
	expect(rowCount).toBeGreaterThan(0);

	// Survives a reload like anything else the user does — it is real, ordinary local data
	// from here on, not a special demo mode.
	await waitForCommitAbove(page, workspaceDb, baseline);
	await page.reload();
	await expect(page.getByRole('link', { name: /Board column drag is broken/ })).toBeVisible();
	await expect(page.getByRole('listitem')).toHaveCount(rowCount);
});

test('the list is sectioned by status across all issues, and not under a one-status filter', async ({
	page
}) => {
	await page.goto('/issues');
	await expect(page.getByText('No issues yet')).toBeVisible();
	await page.getByRole('button', { name: 'Load example issues' }).click();

	// Backlog comes first because the board's columns do, and the seed has issues in it.
	const list = page.getByTestId('issue-list');
	await expect(list.getByRole('heading', { level: 2 }).first()).toHaveText('Backlog');
	await expect(list.getByRole('heading', { name: 'Todo', level: 2 })).toBeVisible();

	// Filtered to one status the filter button already names the section, so a heading would
	// only repeat it.
	await page.getByRole('button', { name: 'All issues' }).click();
	await page.getByRole('menuitem', { name: 'Todo' }).click();
	await expect(list.getByRole('link').first()).toBeVisible();
	await expect(list.getByRole('heading')).toHaveCount(0);
});

test('a quick-added issue is scrolled to and marked, not filed silently off-screen', async ({
	page
}) => {
	// Quick-add appends after the maximum order key, so under the default sort a new issue lands
	// at the END of a virtualized list — off-screen in any viewport that does not show every
	// row. Before `reveal()` the field simply emptied and nothing else changed anywhere, which
	// made the one interaction that could demonstrate "instant by construction" look like
	// nothing had happened.
	//
	// The short viewport is the point: at 600px the end of the list is off-screen, so whichever
	// element is scrolling has to move. An earlier version called virtua's scrollToIndex alone,
	// while `<main>` was the only thing that could scroll, and so moved nothing.
	await page.setViewportSize({ width: 1440, height: 600 });
	await page.goto('/issues');
	await page.getByRole('button', { name: 'Load example issues' }).click();
	await expect(page.locator('[data-issue-link]').first()).toBeVisible();

	const field = page.getByRole('textbox', { name: 'New issue title' });
	await field.fill('Quick-added at the end of the list');
	await field.press('Enter');

	const row = page.getByRole('link', { name: 'Quick-added at the end of the list' });
	await expect(row).toHaveAttribute('aria-current', 'true');

	// Actually on screen, not merely in the DOM: `keepMounted` keeps the cursor's row mounted
	// regardless, so presence proves nothing about whether the visitor can see it.
	await expect
		.poll(() =>
			row.evaluate((el) => {
				const r = el.getBoundingClientRect();
				return r.top >= 0 && r.bottom <= window.innerHeight;
			})
		)
		.toBe(true);

	await expect(field).toHaveValue('');
});
