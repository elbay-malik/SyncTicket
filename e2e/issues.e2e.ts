import { expect, test, type Page } from '@playwright/test';

const DB_NAME = 'syncticket:default';
/** Any well-formed id that cannot exist, used to warm the detail route. */
const ABSENT_ID = '00000000-0000-4000-8000-000000000000';

/** Number of Yjs update rows y-indexeddb has committed for the default workspace. */
function committedUpdates(page: Page): Promise<number> {
	return page.evaluate(
		(db) =>
			new Promise<number>((resolve) => {
				const request = indexedDB.open(db);
				request.onsuccess = () => {
					const conn = request.result;
					if (!conn.objectStoreNames.contains('updates')) {
						conn.close();
						resolve(0);
						return;
					}
					const countReq = conn.transaction('updates').objectStore('updates').count();
					countReq.onsuccess = () => {
						conn.close();
						resolve(countReq.result);
					};
					countReq.onerror = () => {
						conn.close();
						resolve(0);
					};
				};
				request.onerror = () => resolve(0);
			}),
		DB_NAME
	);
}

/**
 * Blocks until y-indexeddb has committed at least one update beyond `baseline`. Reloading
 * without this races the async IndexedDB write. Re-baseline immediately before the write
 * you care about: a stale baseline is already satisfied by an earlier mutation.
 */
async function waitForCommitAbove(page: Page, baseline: number) {
	await page.waitForFunction(
		({ db, base }) =>
			new Promise<boolean>((resolve) => {
				const request = indexedDB.open(db);
				request.onsuccess = () => {
					const conn = request.result;
					if (!conn.objectStoreNames.contains('updates')) {
						conn.close();
						resolve(false);
						return;
					}
					const countReq = conn.transaction('updates').objectStore('updates').count();
					countReq.onsuccess = () => {
						conn.close();
						resolve(countReq.result > base);
					};
					countReq.onerror = () => {
						conn.close();
						resolve(false);
					};
				};
				request.onerror = () => resolve(false);
			}),
		{ db: DB_NAME, base: baseline }
	);
}

/**
 * Visits the detail route once so its lazily-imported chunk is in the module map. Without
 * this, the first navigation to /issues/[id] after going offline has no code to fetch and
 * lands on an error page — the app preloads it on mount, but a test must not race that.
 */
async function warmDetailRoute(page: Page) {
	await page.goto(`/issues/${ABSENT_ID}`);
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.getByRole('button', { name: 'Back to issues' }).click();
	await expect(page).toHaveURL(/\/issues$/);
}

test('quick-add creates an issue that persists across a reload', async ({ page }) => {
	await page.goto('/issues');
	// Empty state implies the store has finished its initial IndexedDB sync, so the
	// baseline update count is stable.
	await expect(page.getByText('No issues yet')).toBeVisible();
	const baseline = await committedUpdates(page);

	const input = page.getByPlaceholder('Add an issue and press Enter…');
	await input.fill('Persisted issue');
	await input.press('Enter');
	await expect(page.getByRole('listitem').filter({ hasText: 'Persisted issue' })).toBeVisible();

	await waitForCommitAbove(page, baseline);

	// A hard reload re-hydrates from IndexedDB — the issue must reappear.
	await page.reload();
	await expect(page.getByRole('listitem').filter({ hasText: 'Persisted issue' })).toBeVisible();
});

test('status filter narrows the list via the derived query index', async ({ page }) => {
	await page.goto('/issues');

	const input = page.getByPlaceholder('Add an issue and press Enter…');
	await input.fill('Backlog task');
	await input.press('Enter');
	await expect(page.getByRole('listitem').filter({ hasText: 'Backlog task' })).toBeVisible();

	// New issues default to Backlog, so filtering to Done should hide it.
	await page.getByRole('button', { name: 'All issues' }).click();
	await page.getByRole('menuitem', { name: 'Done' }).click();
	await expect(page.getByRole('listitem').filter({ hasText: 'Backlog task' })).toHaveCount(0);
	await expect(page.getByText('No matching issues')).toBeVisible();
});

test('full CRUD works offline and the result survives a reload', async ({ page, context }) => {
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
	await dialog.getByLabel('Title').fill('Offline issue');
	await dialog.getByLabel('Description').fill('Written with the network off');
	await page.keyboard.press('ControlOrMeta+Enter');
	await expect(dialog).toBeHidden();
	await expect(page.getByRole('link', { name: 'Offline issue' })).toBeVisible();

	// READ — open the detail sheet at its own URL.
	await page.getByRole('link', { name: 'Offline issue' }).click();
	await expect(page).toHaveURL(/\/issues\/[0-9a-f-]{36}$/);
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
	await expect(page).toHaveURL(/\/issues$/);
	await expect(page.getByRole('link', { name: 'Offline issue, renamed' })).toHaveCount(0);

	// One more issue, so the reload has something to prove.
	const baseline = await committedUpdates(page);
	const input = page.getByPlaceholder('Add an issue and press Enter…');
	await input.fill('Survivor');
	await input.press('Enter');
	await expect(page.getByRole('link', { name: 'Survivor' })).toBeVisible();

	// Reloading needs the network back; the writes above were already local-only.
	await context.setOffline(false);
	await waitForCommitAbove(page, baseline);
	await page.reload();

	await expect(page.getByRole('link', { name: 'Survivor' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Offline issue, renamed' })).toHaveCount(0);
});

test('a detail sheet URL can be shared and reloaded', async ({ page }) => {
	await page.goto('/issues');
	await expect(page.getByText('No issues yet')).toBeVisible();
	const baseline = await committedUpdates(page);

	const input = page.getByPlaceholder('Add an issue and press Enter…');
	await input.fill('Deep linked');
	await input.press('Enter');
	await page.getByRole('link', { name: 'Deep linked' }).click();
	await expect(page.getByRole('dialog').getByLabel('Title')).toHaveValue('Deep linked');

	const url = page.url();
	expect(url).toMatch(/\/issues\/[0-9a-f-]{36}$/);
	await waitForCommitAbove(page, baseline);

	// Loading the URL cold must rebuild the same view from IndexedDB alone.
	await page.goto(url);
	await expect(page.getByRole('dialog').getByLabel('Title')).toHaveValue('Deep linked');

	// Escape closes it and returns to the list.
	await page.keyboard.press('Escape');
	await expect(page).toHaveURL(/\/issues$/);
	await expect(page.getByRole('link', { name: 'Deep linked' })).toBeVisible();
});
