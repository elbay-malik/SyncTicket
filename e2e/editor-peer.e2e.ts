// Two people in the same field, in two real browsers on the relay.
//
// The demo test found two ways this went wrong. A colleague's text landing in a field you had
// selected moved the selection to the end, so typing over it produced "Ada's editGrace's edit".
// And a field whose text an idle commit had already stored kept showing it over a colleague's
// newer edit, then wrote it back when you left, without a keystroke.

import { expect, test, type Browser, type BrowserContext, type Page } from './fixtures.js';

const contexts: BrowserContext[] = [];

test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((context) => context.close()));
});

/** Longer than IDLE_COMMIT_MS in issue-editor.svelte, which Playwright cannot import. */
const PAST_IDLE_COMMIT_MS = 600;

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

async function bothOpenTheSameIssue(browser: Browser) {
	const workspaceId = room();
	const [ada, grace] = await Promise.all([
		openPeer(browser, workspaceId),
		openPeer(browser, workspaceId)
	]);
	const input = ada.getByPlaceholder('Add an issue…');
	await input.fill('Shared issue');
	await input.press('Enter');
	const graceRow = grace.getByRole('link', { name: /Shared issue/ }).first();
	await expect(graceRow).toBeVisible({ timeout: 10_000 });
	await ada
		.getByRole('link', { name: /Shared issue/ })
		.first()
		.click();
	await graceRow.click();
	return {
		ada,
		grace,
		adaTitle: ada.getByRole('dialog').getByLabel('Title'),
		graceTitle: grace.getByRole('dialog').getByLabel('Title')
	};
}

test("typing over a selected title replaces a colleague's text that landed in it", async ({
	browser
}) => {
	const { ada, grace, adaTitle, graceTitle } = await bothOpenTheSameIssue(browser);
	await graceTitle.click();
	await grace.keyboard.press('ControlOrMeta+a');

	// Ada types and stops; her idle commit reaches Grace while Grace's selection is up.
	await adaTitle.click();
	await ada.keyboard.press('ControlOrMeta+a');
	await ada.keyboard.type("Ada's edit");
	await expect(graceTitle).toHaveValue("Ada's edit", { timeout: 10_000 });

	await grace.keyboard.type("Grace's edit");
	await grace.keyboard.press('Enter');

	await expect(graceTitle).toHaveValue("Grace's edit");
	await expect(adaTitle).toHaveValue("Grace's edit", { timeout: 10_000 });
});

test("leaving a field whose text was already stored keeps a colleague's newer edit", async ({
	browser
}) => {
	const { ada, grace, adaTitle, graceTitle } = await bothOpenTheSameIssue(browser);
	await adaTitle.click();
	await ada.keyboard.press('ControlOrMeta+a');
	await ada.keyboard.type("Ada's edit");
	await expect(graceTitle).toHaveValue("Ada's edit", { timeout: 10_000 });
	await ada.waitForTimeout(PAST_IDLE_COMMIT_MS);

	await graceTitle.fill("Grace's edit");
	await graceTitle.press('Enter');

	// Ada is still in the field, and it converges without her leaving it.
	await expect(adaTitle).toHaveValue("Grace's edit", { timeout: 10_000 });
	await expect(adaTitle).toBeFocused();

	await ada.keyboard.press('Tab');
	await ada.waitForTimeout(500);
	await expect(adaTitle).toHaveValue("Grace's edit");
	await expect(graceTitle).toHaveValue("Grace's edit");
	await expect(grace.getByRole('link', { name: /Grace's edit/ }).first()).toBeVisible();
});
