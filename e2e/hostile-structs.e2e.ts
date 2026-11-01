// What the unit tests cannot show: bytes no Yjs client would write going through the real relay,
// which runs the same patched Yjs under workerd, and on to real browsers. Each of these used to stop
// the room from answering, or made its answers throw in everyone who arrived, while the room went on
// looking healthy. They go down the provider's socket by hand, because Yjs would not send them, and
// a hostile client is not obliged to use Yjs.

import YProvider from 'y-partyserver/provider';
import * as Y from 'yjs';
import { expect, test, type Page } from './fixtures.js';

/** Must match RELAY_PORT in playwright.config.ts and RELAY_PARTY in src/lib/sync/provider.ts. */
const RELAY_HOST = 'localhost:18791';
const RELAY_PARTY = 'y-doc-room';

function varUint(value: number): number[] {
	const bytes: number[] = [];
	let rest = value;
	while (rest > 127) {
		bytes.push((rest % 128) | 128);
		rest = Math.floor(rest / 128);
	}
	bytes.push(rest);
	return bytes;
}

function utf8(text: string): number[] {
	const bytes = [...new TextEncoder().encode(text)];
	return [...varUint(bytes.length), ...bytes];
}

/** An item under a fresh key of `issues`, with the given reference number and content bytes. */
function item(ref: number, content: number[]): number[] {
	const hasParentSub = 32;
	return [hasParentSub | ref, 1, ...utf8('issues'), ...utf8(crypto.randomUUID()), ...content];
}

const ANY = 8;
const STRING_VALUE = [1, 119, ...utf8('junk')];

const PAYLOADS: ReadonlyArray<{ name: string; update: () => Uint8Array }> = [
	{
		name: 'a GC of no length',
		update: () => Uint8Array.from([1, 1, 0xe1, 0x3c, 0, 0, 0, 0])
	},
	{
		name: 'an empty item after a normal one',
		update: () =>
			Uint8Array.from([1, 2, 0xe1, 0x3c, 0, ...item(ANY, STRING_VALUE), ...item(ANY, [0]), 0])
	},
	{
		name: 'a delete-set entry of no length',
		update: () => Uint8Array.from([0, 1, 0xe1, 0x3c, 1, 0, 0])
	}
];

/**
 * Whatever goes wrong on the page, including what y-protocols catches for itself: a throw while
 * applying a sync step 2 is only ever logged, so the page looks synced while holding half of it.
 */
function collectErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.text().includes('Caught error while handling a Yjs update')) {
			errors.push(message.text());
		}
	});
	return errors;
}

/** Fails, by timing out, on a room that no longer sends a sync step 2. */
async function asPeer(workspaceId: string, write: (doc: Y.Doc) => void): Promise<void> {
	const doc = new Y.Doc();
	const provider = new YProvider(RELAY_HOST, workspaceId, doc, { party: RELAY_PARTY });
	await new Promise<void>((resolve) => {
		provider.once('synced', () => resolve());
	});
	write(doc);
	await new Promise((resolve) => setTimeout(resolve, 500));
	provider.destroy();
	doc.destroy();
}

async function sendRaw(workspaceId: string, update: Uint8Array): Promise<void> {
	const doc = new Y.Doc();
	const provider = new YProvider(RELAY_HOST, workspaceId, doc, { party: RELAY_PARTY });
	await new Promise<void>((resolve) => {
		provider.once('synced', () => resolve());
	});
	const messageSync = 0;
	const messageUpdate = 2;
	provider.ws?.send(
		Uint8Array.from([messageSync, messageUpdate, ...varUint(update.length), ...update])
	);
	await new Promise((resolve) => setTimeout(resolve, 500));
	provider.destroy();
	doc.destroy();
}

function peerIssue(title: string, order: string): Y.Map<unknown> {
	const yIssue = new Y.Map<unknown>();
	yIssue.set('title', title);
	yIssue.set('status', 'todo');
	yIssue.set('priority', 'none');
	yIssue.set('order', order);
	return yIssue;
}

for (const { name, update } of PAYLOADS) {
	test(`${name} leaves the room answering and everyone syncing`, async ({
		browser,
		page,
		workspaceId
	}) => {
		const errors = collectErrors(page);
		await page.goto('/issues');
		await expect(page.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
			timeout: 30_000
		});
		await asPeer(workspaceId, (doc) => {
			doc.getMap<unknown>('issues').set(crypto.randomUUID(), peerIssue('Before', 'a0'));
		});
		await expect(page.getByRole('link', { name: 'Before' })).toBeVisible({ timeout: 10_000 });

		await sendRaw(workspaceId, update());

		const field = page.getByRole('textbox', { name: 'New issue title' });
		await field.fill('Written after');
		await field.press('Enter');
		await expect(page.getByRole('link', { name: 'Written after' })).toBeVisible();

		// The room still answers someone new, with what was written after the attack.
		let seen: unknown[] = [];
		await expect
			.poll(
				async () => {
					await asPeer(workspaceId, (doc) => {
						seen = [...doc.getMap<unknown>('issues').values()].map((issue) =>
							issue instanceof Y.Map ? issue.get('title') : null
						);
					});
					return seen;
				},
				{ timeout: 20_000 }
			)
			.toContain('Written after');

		// A browser arriving now finishes syncing, which is the thing the throw used to stop.
		const context = await browser.newContext();
		const visitor = await context.newPage();
		const visitorErrors = collectErrors(visitor);
		await visitor.goto(`/issues?ws=${workspaceId}`);
		await expect(visitor.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
			timeout: 30_000
		});
		await expect(visitor.getByRole('link', { name: 'Written after' })).toBeVisible();
		await context.close();
		expect(errors).toEqual([]);
		expect(visitorErrors).toEqual([]);
	});
}
