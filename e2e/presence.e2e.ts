// Phase 10 acceptance: two people see each other, and stop seeing each other when one goes.
//
// Each peer gets its own browser context, not a second page in the same one. Contexts share
// localStorage and a BroadcastChannel, so two pages in one context would be the *same*
// person in two tabs — which presence deliberately collapses into a single avatar, and which
// would make this test assert the opposite of what it means to.
//
// Identity is seeded rather than generated, because the generated name is random and there
// would otherwise be nothing stable to select on.

import { expect, test, type Browser, type Page } from './fixtures.js';
import { IDENTITY_STORAGE_KEY } from '../src/lib/model/identity.js';
import { WORKSPACE_STORAGE_KEY } from '../src/lib/model/workspace.js';

const room = () => `t${crypto.randomUUID().replace(/-/g, '')}`;

interface Peer {
	page: Page;
	close: () => Promise<void>;
}

/** Opens one person, in their own context, already synced to `workspaceId`. */
async function openPeer(
	browser: Browser,
	workspaceId: string,
	identity: { userId: string; name: string; hue: number }
): Promise<Peer> {
	const context = await browser.newContext();
	await context.addInitScript(
		([wsKey, id, idKey, who]) => {
			window.localStorage.setItem(wsKey as string, id as string);
			window.localStorage.setItem(idKey as string, who as string);
		},
		[WORKSPACE_STORAGE_KEY, workspaceId, IDENTITY_STORAGE_KEY, JSON.stringify(identity)]
	);
	const page = await context.newPage();
	await page.goto('/issues');
	await expect(page.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 30_000
	});
	return { page, close: () => context.close() };
}

const ADA = { userId: `u${'a'.repeat(32)}`, name: 'Ada Lovelace', hue: 210 };
const GRACE = { userId: `u${'b'.repeat(32)}`, name: 'Grace Hopper', hue: 45 };

test('two people see each other, and presence clears when one leaves', async ({ browser }) => {
	const workspaceId = room();
	const [ada, grace] = await Promise.all([
		openPeer(browser, workspaceId, ADA),
		openPeer(browser, workspaceId, GRACE)
	]);

	const gracesView = grace.page.getByTestId('presence-peers');
	const adasView = ada.page.getByTestId('presence-peers');

	// Each sees both avatars: their own and the other person's.
	await expect(gracesView.locator(`[data-peer="${ADA.name}"]`)).toBeVisible({ timeout: 15_000 });
	await expect(gracesView.locator(`[data-peer="${GRACE.name}"]`)).toBeVisible();
	await expect(adasView.locator(`[data-peer="${GRACE.name}"]`)).toBeVisible({ timeout: 15_000 });

	// The name is in the accessible label, not only in the colour of a circle.
	await expect(grace.page.getByTestId('presence-bar')).toHaveAttribute(
		'aria-label',
		/You are Grace Hopper\. Ada Lovelace is also here\./
	);

	// The acceptance criterion. A closed context is a closed socket, which the relay turns
	// into an awareness removal, so this should be fast rather than merely eventual.
	await ada.close();
	await expect(gracesView.locator(`[data-peer="${ADA.name}"]`)).toHaveCount(0, {
		timeout: 10_000
	});
	// Grace is still there; clearing presence removed one person, not the feature.
	await expect(gracesView.locator(`[data-peer="${GRACE.name}"]`)).toBeVisible();

	await grace.close();
});

test('opening an issue shows you on it to everyone else', async ({ browser }) => {
	const workspaceId = room();
	const [ada, grace] = await Promise.all([
		openPeer(browser, workspaceId, ADA),
		openPeer(browser, workspaceId, GRACE)
	]);

	const input = ada.page.getByPlaceholder('Add an issue…');
	await input.fill('Who is looking at this');
	await input.press('Enter');
	const link = grace.page.getByRole('link', { name: 'Who is looking at this' });
	await expect(link).toBeVisible({ timeout: 15_000 });

	// Nobody is on it yet.
	await expect(grace.page.getByTestId('row-viewers')).toHaveCount(0);

	await ada.page.getByRole('link', { name: 'Who is looking at this' }).click();
	await expect(ada.page.getByTestId('issue-sheet')).toBeVisible();

	// Grace's row now shows Ada, and the row's own accessible name says so — the avatar is
	// decoration, and a screen reader would otherwise be told nothing at all.
	await expect(
		grace.page.getByTestId('row-viewers').locator(`[data-peer="${ADA.name}"]`)
	).toBeVisible({ timeout: 15_000 });
	await expect(link).toHaveAccessibleName(/Ada Lovelace is viewing/);

	// Grace opens the same issue and is told, in words, that she is not alone in it.
	await link.click();
	await expect(grace.page.getByTestId('sheet-viewers')).toContainText(
		'Ada Lovelace is also viewing this issue'
	);

	// Leaving the issue takes the indicator away again.
	await ada.page.keyboard.press('Escape');
	await expect(ada.page.getByTestId('issue-sheet')).toHaveCount(0);
	await expect(grace.page.getByTestId('sheet-viewers')).toHaveCount(0, { timeout: 15_000 });

	await Promise.all([ada.close(), grace.close()]);
});

test('a workspace of one shows only you, with no relay traffic to speak of', async ({
	browser
}) => {
	const solo = await openPeer(browser, room(), ADA);

	await expect(
		solo.page.getByTestId('presence-peers').locator(`[data-peer="${ADA.name}"]`)
	).toBeVisible();
	await expect(solo.page.getByTestId('presence-bar')).toHaveAttribute(
		'aria-label',
		/You are Ada Lovelace\. Nobody else is here\./
	);
	await expect(solo.page.getByTestId('presence-bar')).toHaveAttribute('data-peer-count', '1');

	await solo.close();
});

test('you can change what other people call you', async ({ browser }) => {
	const workspaceId = room();
	const [ada, grace] = await Promise.all([
		openPeer(browser, workspaceId, ADA),
		openPeer(browser, workspaceId, GRACE)
	]);

	const gracesView = grace.page.getByTestId('presence-peers');
	await expect(gracesView.locator(`[data-peer="${ADA.name}"]`)).toBeVisible({ timeout: 15_000 });

	await ada.page.getByTestId('presence-bar').click();
	// By role, not by label: the presence button's own aria-label ends in "Change your
	// display name", so a label lookup matches it too.
	const field = ada.page.getByRole('textbox', { name: 'Name' });
	await expect(field).toBeVisible();
	await field.fill('Ada L');
	// exact: true — Phase 11's connection-status button carries an aria-label that starts
	// with "Saved on this device", which a substring match on 'Save' would also catch.
	await ada.page.getByRole('button', { name: 'Save', exact: true }).click();

	await expect(gracesView.locator('[data-peer="Ada L"]')).toBeVisible({ timeout: 15_000 });
	await expect(gracesView.locator(`[data-peer="${ADA.name}"]`)).toHaveCount(0);

	// And it is written down, rather than lasting only as long as the tab. Checked in
	// storage rather than by reloading: this context re-seeds the identity on every
	// navigation, so a reload here would be measuring the fixture, not the feature.
	const stored = await ada.page.evaluate(
		(key) => window.localStorage.getItem(key),
		IDENTITY_STORAGE_KEY
	);
	expect(JSON.parse(stored ?? '{}')).toMatchObject({ name: 'Ada L', userId: ADA.userId });

	await Promise.all([ada.close(), grace.close()]);
});
