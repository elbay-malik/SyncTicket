// Undo takes back what this client did and nothing else. Two peers formatting the same Y.Text at
// once leaves redundant markers, and Yjs tidies those up in a new local transaction with no origin,
// on whichever replica receives them. A store that tracked "no origin" counted that as its visitor's
// own edit: a step they never took appeared on their stack, a keypress spent itself taking it back,
// and their redo stack was wiped. Everything here arrives as real updates from separate documents.

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { getIssuesMap } from '$lib/sync/doc.js';
import { REAL_ID, peerWrites, wellFormedIssue } from '$lib/sync/junk-entries.fixture.js';
import { IssueStore } from './issues.svelte.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length) cleanups.pop()?.();
});

async function open() {
	const provider = { fake: 'relay provider' };
	let attached = null as Y.Doc | null;
	const store = new IssueStore(`undo-${crypto.randomUUID()}`, {
		attachRelay: (doc) => {
			attached = doc;
			const awareness = new Awareness(doc);
			clearInterval(awareness._checkInterval);
			return { provider: provider as never, awareness, destroy: () => awareness.destroy() };
		}
	});
	cleanups.push(() => store.destroy());
	await vi.waitFor(() => expect(store.synced).toBe(true), { timeout: 4_000 });
	return { store, doc: attached as unknown as Y.Doc, provider };
}

type Opened = Awaited<ReturnType<typeof open>>;

function replicaOf(doc: Y.Doc): { peer: Y.Doc; text: Y.Text } {
	const peer = new Y.Doc();
	Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
	const yIssue = getIssuesMap(peer).get(REAL_ID) as Y.Map<unknown>;
	return { peer, text: yIssue.get('zzz') as Y.Text };
}

/** An issue with a Y.Text in a field nothing reads, the way any peer can leave one. */
function plantText({ doc, provider }: Opened): void {
	peerWrites(
		doc,
		(issues) => {
			const yIssue = wellFormedIssue({ title: 'Theirs' });
			issues.set(REAL_ID, yIssue);
			yIssue.set('zzz', new Y.Text('hello world'));
		},
		provider
	);
}

/** Two peers bold the same text without seeing each other, and both reach the store. */
function formatConcurrently({ doc, provider }: Opened): void {
	const since = Y.encodeStateVector(doc);
	const a = replicaOf(doc);
	a.peer.clientID = 101;
	const b = replicaOf(doc);
	b.peer.clientID = 102;
	a.text.format(0, 5, { bold: true });
	b.text.format(0, 5, { bold: true });
	Y.applyUpdate(doc, Y.encodeStateAsUpdate(a.peer, since), provider);
	Y.applyUpdate(doc, Y.encodeStateAsUpdate(b.peer, since), provider);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 350));

describe("a peer's concurrent Y.Text formatting", () => {
	it('puts nothing on the stack of someone who has done nothing', async () => {
		const opened = await open();
		plantText(opened);
		expect(opened.store.canUndo).toBe(false);

		formatConcurrently(opened);

		expect(opened.store.canUndo).toBe(false);
		expect(opened.store.undo()).toBe(false);
	});

	it('leaves their redo where it was', async () => {
		const opened = await open();
		plantText(opened);
		opened.store.update(REAL_ID, { title: 'one' });
		await settle();
		opened.store.update(REAL_ID, { title: 'two' });
		opened.store.undo();
		expect(opened.store.get(REAL_ID)?.title).toBe('one');
		expect(opened.store.canRedo).toBe(true);

		formatConcurrently(opened);

		expect(opened.store.canRedo).toBe(true);
		expect(opened.store.redo()).toBe(true);
		expect(opened.store.get(REAL_ID)?.title).toBe('two');
	});

	it('does not take the next undo for itself', async () => {
		const opened = await open();
		plantText(opened);
		opened.store.update(REAL_ID, { title: 'first' });
		await settle();
		opened.store.update(REAL_ID, { title: 'second' });
		await settle();

		formatConcurrently(opened);

		expect(opened.store.undo()).toBe(true);
		expect(opened.store.get(REAL_ID)?.title).toBe('first');
	});
});

describe('what scoping undo to the store must not change', () => {
	it('still undoes every kind of write the store makes, one step each', async () => {
		const { store } = await open();

		const id = store.create({ title: 'Created' });
		await settle();
		store.update(id, { title: 'Updated' });
		await settle();
		store.move(id, 'done', [id]);
		await settle();
		store.remove(id);
		await settle();
		const seeded = store.seedDemo();
		expect(seeded.length).toBeGreaterThan(0);
		await settle();
		const benchmarked = store.seed(2);

		expect(store.undo()).toBe(true);
		for (const each of benchmarked) expect(store.get(each)).toBeUndefined();
		await settle();
		expect(store.undo()).toBe(true);
		for (const each of seeded) expect(store.get(each)).toBeUndefined();
		expect(store.get(id)).toBeUndefined();
		expect(store.undo()).toBe(true);
		expect(store.get(id)?.status).toBe('done');
		expect(store.undo()).toBe(true);
		expect(store.get(id)?.status).not.toBe('done');
		expect(store.undo()).toBe(true);
		expect(store.get(id)?.title).toBe('Created');
		expect(store.undo()).toBe(true);
		expect(store.get(id)).toBeUndefined();
		expect(store.undo()).toBe(false);
	});

	it('still sends what the store writes, and what Yjs tidies up, to everyone else', async () => {
		const opened = await open();
		plantText(opened);
		const sent: unknown[] = [];
		opened.doc.on('update', (_update: Uint8Array, origin: unknown) => {
			if (origin !== opened.provider) sent.push(origin);
		});

		formatConcurrently(opened);
		const tidied = sent.length;
		opened.store.update(REAL_ID, { title: 'Mine' });

		expect(tidied).toBeGreaterThan(0);
		expect(sent.length).toBe(tidied + 1);
	});
});
