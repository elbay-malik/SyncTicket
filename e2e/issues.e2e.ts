import { expect, test, type Page } from '@playwright/test';

const DB_NAME = 'syncticket:default';

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

	// Wait until y-indexeddb has actually committed the new update before reloading —
	// otherwise the reload can race the async write and the assertion becomes flaky.
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
