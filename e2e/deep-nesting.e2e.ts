// What the unit tests cannot show: a chain of nested types deeper than the stack going through the
// real relay, which runs the same Yjs under workerd, and into a real browser's real database. The
// peer is a plain Yjs client in this process, as in hostile-issue-id.e2e.ts.

import YProvider from 'y-partyserver/provider';
import * as Y from 'yjs';
import { expect, test, type Page } from './fixtures.js';

/** Must match RELAY_PORT in playwright.config.ts and RELAY_PARTY in src/lib/sync/provider.ts. */
const RELAY_HOST = 'localhost:18791';
const RELAY_PARTY = 'y-doc-room';

/** Past Chromium's limit, about 2,500 levels, for about 36 KB. */
const DEPTH = 3_000;

function collectErrors(page: Page): Error[] {
	const errors: Error[] = [];
	page.on('pageerror', (error) => errors.push(error));
	return errors;
}

async function openSynced(page: Page): Promise<void> {
	await page.goto('/issues');
	await expect(page.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 30_000
	});
}

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

function peerIssue(title: string, order: string): Y.Map<unknown> {
	const yIssue = new Y.Map<unknown>();
	yIssue.set('title', title);
	yIssue.set('status', 'todo');
	yIssue.set('priority', 'none');
	yIssue.set('order', order);
	return yIssue;
}

function nest(yIssue: Y.Map<unknown>): void {
	let current = new Y.Map<unknown>();
	yIssue.set('zzz', current);
	for (let level = 1; level < DEPTH; level += 1) {
		const next = new Y.Map<unknown>();
		current.set('n', next);
		current = next;
	}
}

test('an issue holding one can be deleted, by a second browser too, and the workspace reloads', async ({
	page,
	workspaceId
}) => {
	const errors = collectErrors(page);
	await openSynced(page);
	const id = crypto.randomUUID();
	await asPeer(workspaceId, (doc) => {
		const issues = doc.getMap<unknown>('issues');
		issues.set(crypto.randomUUID(), peerIssue('Kept', 'a0'));
		const yIssue = peerIssue('Innocent', 'a1');
		issues.set(id, yIssue);
		doc.transact(() => nest(yIssue));
	});
	const row = page.getByRole('link', { name: 'Innocent' });
	await expect(row).toBeVisible({ timeout: 10_000 });

	await row.click();
	const sheet = page.getByRole('dialog', { name: 'Innocent' });
	await sheet.getByRole('button', { name: 'Delete' }).click();
	await page.getByRole('button', { name: 'Delete issue' }).click();
	await expect(row).toHaveCount(0);

	await page.reload();
	await expect(page.getByRole('link', { name: 'Kept' })).toBeVisible();
	await expect(row).toHaveCount(0);
	expect(errors).toEqual([]);

	// The relay took the delete too: someone new is told the same thing, and it still takes writes.
	await asPeer(workspaceId, (doc) => {
		expect(doc.getMap<unknown>('issues').has(id)).toBe(false);
		doc.getMap<unknown>('issues').set(crypto.randomUUID(), peerIssue('After', 'a2'));
	});
	await expect(page.getByRole('link', { name: 'After' })).toBeVisible({ timeout: 10_000 });
	expect(errors).toEqual([]);
});

test('one that arrives already deleted leaves no ghost, and the room goes on working', async ({
	page,
	workspaceId
}) => {
	const errors = collectErrors(page);
	await openSynced(page);

	await asPeer(workspaceId, (doc) => {
		const issues = doc.getMap<unknown>('issues');
		const id = crypto.randomUUID();
		const yIssue = peerIssue('Innocent', 'a1');
		issues.set(id, yIssue);
		doc.transact(() => nest(yIssue));
		issues.delete(id);
	});
	await asPeer(workspaceId, (doc) => {
		doc.getMap<unknown>('issues').set(crypto.randomUUID(), peerIssue('After', 'a2'));
	});

	await expect(page.getByRole('link', { name: 'After' })).toBeVisible({ timeout: 10_000 });
	await expect(page.getByRole('link', { name: 'Innocent' })).toHaveCount(0);

	await page.reload();
	await expect(page.getByRole('link', { name: 'After' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Innocent' })).toHaveCount(0);
	expect(errors).toEqual([]);
});

/**
 * A value that decodes and then overflows on its way out again, as one hand-written item under
 * `issues`. `Y.applyUpdate` on a peer's own document would clean it up before it left, so it goes
 * straight down the provider's socket, the way a client that isn't this one would send it.
 */
function frozenUpdate(depth: number): Uint8Array {
	const utf8 = (text: string): number[] => {
		const bytes = [...new TextEncoder().encode(text)];
		return [...varUint(bytes.length), ...bytes];
	};
	const json = utf8(`${'['.repeat(depth)}{"toJSON":1}${']'.repeat(depth)}`);
	return Uint8Array.from([
		1,
		1,
		...varUint(7_777),
		0,
		32 | 2,
		1,
		...utf8('issues'),
		...utf8(crypto.randomUUID()),
		1,
		...json,
		0
	]);
}

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

// Either side of where Chromium's stack gives out on this value, and past where the relay's does.
for (const depth of [5_118, 5_300, 20_000]) {
	test(`a plain value nested ${depth} deep freezes nobody, now or on arrival`, async ({
		browser,
		page,
		workspaceId
	}) => {
		const errors = collectErrors(page);
		await openSynced(page);
		await asPeer(workspaceId, (doc) => {
			doc.getMap<unknown>('issues').set(crypto.randomUUID(), peerIssue('Before', 'a0'));
		});
		await expect(page.getByRole('link', { name: 'Before' })).toBeVisible({ timeout: 10_000 });

		await sendRaw(workspaceId, frozenUpdate(depth));

		// The tab it reached is still alive in both directions.
		const field = page.getByRole('textbox', { name: 'New issue title' });
		await field.fill('Written after');
		await field.press('Enter');
		await expect(page.getByRole('link', { name: 'Written after' })).toBeVisible();
		await asPeer(workspaceId, (doc) => {
			expect(
				[...doc.getMap<Y.Map<unknown>>('issues').values()].map((issue) =>
					issue instanceof Y.Map ? issue.get('title') : null
				)
			).toContain('Written after');
			doc.getMap<unknown>('issues').set(crypto.randomUUID(), peerIssue('Live', 'a1'));
		});
		await expect(page.getByRole('link', { name: 'Live' })).toBeVisible({ timeout: 10_000 });

		// Someone arriving now gets all of it, and can write too.
		const context = await browser.newContext();
		const visitor = await context.newPage();
		const visitorErrors = collectErrors(visitor);
		await visitor.goto(`/issues?ws=${workspaceId}`);
		await expect(visitor.getByRole('link', { name: 'Written after' })).toBeVisible({
			timeout: 30_000
		});
		const visitorField = visitor.getByRole('textbox', { name: 'New issue title' });
		await visitorField.fill('From the visitor');
		await visitorField.press('Enter');
		await expect(visitor.getByRole('link', { name: 'From the visitor' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'From the visitor' })).toBeVisible({
			timeout: 10_000
		});
		await context.close();
		expect(errors).toEqual([]);
		expect(visitorErrors).toEqual([]);
	});
}

/** How long the page's main thread went without running a timer, since `watchStalls`. */
async function watchStalls(page: Page): Promise<() => Promise<number>> {
	await page.evaluate(() => {
		const watch = { last: performance.now(), longest: 0 };
		setInterval(() => {
			const now = performance.now();
			watch.longest = Math.max(watch.longest, now - watch.last);
			watch.last = now;
		}, 50);
		(window as unknown as { stallWatch: typeof watch }).stallWatch = watch;
	});
	return () =>
		page.evaluate(
			() => (window as unknown as { stallWatch: { longest: number } }).stallWatch.longest
		);
}

/** Stock Yjs stalled the page 18 s at 12,000 and took the local relay's memory by 24,000. */
for (const depth of [12_000, 24_000]) {
	test(`one update touching all ${depth} levels of a chain leaves the tab responsive`, async ({
		page,
		workspaceId
	}) => {
		test.setTimeout(120_000);
		const errors = collectErrors(page);
		await openSynced(page);
		await asPeer(workspaceId, (doc) => {
			const yIssue = peerIssue('Innocent', 'a1');
			doc.getMap<unknown>('issues').set(crypto.randomUUID(), yIssue);
			doc.transact(() => {
				let current = new Y.Map<unknown>();
				yIssue.set('zzz', current);
				for (let level = 1; level < depth; level += 1) {
					const next = new Y.Map<unknown>();
					current.set('n', next);
					current = next;
				}
			});
		});
		await expect(page.getByRole('link', { name: 'Innocent' })).toBeVisible({ timeout: 30_000 });
		const longestStall = await watchStalls(page);

		await asPeer(workspaceId, (doc) => {
			const issues = doc.getMap<unknown>('issues');
			doc.transact(() => {
				for (const entry of issues.values()) {
					let level = (entry as Y.Map<unknown>).get('zzz');
					while (level instanceof Y.Map) {
						level.set('x', 1);
						level = level.get('n');
					}
				}
			});
			issues.set(crypto.randomUUID(), peerIssue('Marker', 'a2'));
		});

		await expect(page.getByRole('link', { name: 'Marker' })).toBeVisible({ timeout: 30_000 });
		expect(await longestStall()).toBeLessThan(5_000);
		expect(errors).toEqual([]);
	});
}
