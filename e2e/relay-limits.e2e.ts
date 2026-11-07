// What the relay refuses, against the real worker.
//
// Its message limits are unit-tested in workers/relay/src/message-limits.test.ts; what needs the
// real thing is that an ordinary visit still works with them in place (every other relay test
// does that) and that the connection check refuses a page served from somewhere else.

import { expect, test } from './fixtures.js';

const room = () => `t${crypto.randomUUID().replace(/-/g, '')}`;

test('a page served from another origin cannot open the relay', async ({ browser }) => {
	// The same app on 127.0.0.1 rather than localhost: another origin, as far as a browser and
	// the relay are concerned, and not one the e2e relay allows.
	const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' });
	const page = await context.newPage();
	await page.goto(`/issues?ws=${room()}`);
	const status = page.getByTestId('relay-status');
	await expect(status).toHaveAttribute('data-connection', 'offline', { timeout: 10_000 });
	await expect(status).not.toHaveAttribute('data-synced', 'true');
	await context.close();
});

test('two people still see each other and each other’s edits through the limits', async ({
	browser
}) => {
	const workspaceId = room();
	const [alice, bob] = await Promise.all(
		[0, 1].map(async () => {
			const page = await (await browser.newContext()).newPage();
			await page.goto(`/issues?ws=${workspaceId}`);
			await expect(page.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
				timeout: 30_000
			});
			return page;
		})
	);
	for (const page of [alice!, bob!]) {
		await expect(page.getByTestId('relay-status')).toHaveAttribute(
			'aria-label',
			/Shared with 1 other/
		);
	}
	const input = alice!.getByPlaceholder('Add an issue…');
	await input.fill('Through the gate');
	await input.press('Enter');
	await expect(bob!.getByRole('link', { name: 'Through the gate' })).toBeVisible();

	// Presence stays right after one of them reloads: the new socket takes over the old one's
	// client, and the old one closing does not clear it.
	await bob!.reload();
	await expect(bob!.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 30_000
	});
	for (const page of [alice!, bob!]) {
		await expect(page.getByTestId('relay-status')).toHaveAttribute(
			'aria-label',
			/Shared with 1 other/,
			{ timeout: 15_000 }
		);
	}
	await Promise.all([alice!.context().close(), bob!.context().close()]);
});
