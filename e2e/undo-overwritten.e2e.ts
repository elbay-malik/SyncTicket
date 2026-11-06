// Escape or Undo after a colleague overwrote your edit. Yjs refuses to restore over their newer
// value, so that step changes nothing, and it used to fall through to the step before: the creation
// of the issue, deleted for everyone. The unit tests pin the store; this pins the keys a person
// presses, in two real browsers on the relay. See undoOneStep in src/lib/sync/doc.ts.

import { expect, test, type Browser, type BrowserContext, type Page } from './fixtures.js';

const contexts: BrowserContext[] = [];

test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((context) => context.close()));
});

const room = () => `t${crypto.randomUUID().replace(/-/g, '')}`;

async function openPeer(browser: Browser, workspaceId: string): Promise<Page> {
	const context = await browser.newContext();
	contexts.push(context);
	const page = await context.newPage();
	await page.goto(`/issues?ws=${workspaceId}`);
	await expect(page.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 30_000
	});
	return page;
}

/** Ada creates an issue and opens it without reloading, so the creation stays on her undo stack. */
async function bothOpenANewIssue(browser: Browser, workspaceId: string) {
	const [ada, grace] = await Promise.all([
		openPeer(browser, workspaceId),
		openPeer(browser, workspaceId)
	]);
	const input = ada.getByPlaceholder('Add an issue…');
	await input.fill('Shared issue');
	await input.press('Enter');
	const row = grace.getByRole('link', { name: /Shared issue/ }).first();
	await expect(row).toBeVisible({ timeout: 10_000 });

	await ada
		.getByRole('link', { name: /Shared issue/ })
		.first()
		.click();
	await row.click();
	return { ada, grace };
}

/** Ada types and lets it commit, then Grace, having seen it, renames the issue on top. */
async function graceOverwritesAda(ada: Page, grace: Page) {
	const adaTitle = ada.getByRole('dialog').getByLabel('Title');
	const graceTitle = grace.getByRole('dialog').getByLabel('Title');
	await adaTitle.fill("Ada's edit");
	await expect(graceTitle).toHaveValue("Ada's edit", { timeout: 10_000 });
	await graceTitle.fill("Grace's edit");
	await graceTitle.press('Enter');
}

/** A visitor with nothing in memory, so this is what the relay really holds. */
async function expectStillThere(browser: Browser, workspaceId: string, title: string) {
	const fresh = await openPeer(browser, workspaceId);
	await expect(fresh.getByRole('link', { name: title }).first()).toBeVisible({ timeout: 10_000 });
}

test('Escape keeps an issue a colleague has renamed since', async ({ browser }) => {
	const workspaceId = room();
	const { ada, grace } = await bothOpenANewIssue(browser, workspaceId);
	await graceOverwritesAda(ada, grace);
	// Ada's own field shows her draft until she leaves it, so the rename has to be seen arriving
	// somewhere she can see it: the row behind the sheet.
	await expect(ada.getByRole('link', { name: /Grace's edit/ }).first()).toBeVisible({
		timeout: 10_000
	});

	await ada.getByRole('dialog').getByLabel('Title').press('Escape');

	await expect(ada.getByRole('dialog').getByLabel('Title')).toHaveValue("Grace's edit");
	await expect(grace.getByRole('dialog').getByLabel('Title')).toHaveValue("Grace's edit");
	await expectStillThere(browser, workspaceId, "Grace's edit");
});

test('Undo keeps an issue a colleague has renamed since', async ({ browser }) => {
	const workspaceId = room();
	const { ada, grace } = await bothOpenANewIssue(browser, workspaceId);
	const adaTitle = ada.getByRole('dialog').getByLabel('Title');
	await adaTitle.fill("Ada's edit");
	await adaTitle.press('Enter');
	await expect(grace.getByRole('dialog').getByLabel('Title')).toHaveValue("Ada's edit", {
		timeout: 10_000
	});
	await grace.getByRole('dialog').getByLabel('Title').fill("Grace's edit");
	await grace.getByRole('dialog').getByLabel('Title').press('Enter');
	await expect(adaTitle).toHaveValue("Grace's edit", { timeout: 10_000 });

	await ada.keyboard.press('Escape');
	await expect(ada.getByRole('dialog')).toBeHidden();
	await ada.getByRole('button', { name: /undo/i }).first().click();

	await expect(ada.getByRole('link', { name: /Grace's edit/ }).first()).toBeVisible();
	await expectStillThere(browser, workspaceId, "Grace's edit");
});
