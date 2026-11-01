// What a deep chain of nested types used to do to a store: Delete threw halfway, the half-finished
// update went into IndexedDB, and the next load overflowed inside y-indexeddb, which has no way to
// report that, so `synced` never came and the visitor sat on the skeleton. These run on the real
// database, because the load is the part that hung. sync/deep-nesting.test.ts has the document.

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { getIssuesMap } from '$lib/sync/doc.js';
import {
	VALUE_CONTENT,
	chainUnder,
	handWrittenItem,
	nestMaps,
	nestedJson,
	peerWrites,
	REAL_ID,
	SLOT_ID,
	splitChain,
	treeAndItsDelete,
	wellFormedIssue
} from '$lib/sync/junk-entries.fixture.js';
import { attachPersistence } from '$lib/sync/persistence.js';
import { IssueStore } from './issues.svelte.js';

/** Past Chromium's limit, about 2,500 levels, for about 36 KB. */
const DEPTH = 3_000;

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length) cleanups.pop()?.();
});

/** A loaded store whose relay the test plays, keeping what it would have sent. */
async function open(workspaceId = `deep-${crypto.randomUUID()}`) {
	const provider = { fake: 'relay provider' };
	let attached = null as Y.Doc | null;
	const store = new IssueStore(workspaceId, {
		attachRelay: (doc) => {
			attached = doc;
			const awareness = new Awareness(doc);
			clearInterval(awareness._checkInterval);
			return { provider: provider as never, awareness, destroy: () => awareness.destroy() };
		}
	});
	let closed = false;
	const close = () => {
		if (closed) return;
		closed = true;
		store.destroy();
	};
	cleanups.push(close);
	await vi.waitFor(() => expect(store.synced).toBe(true), { timeout: 4_000 });
	const doc = attached as unknown as Y.Doc;
	const sent: Uint8Array[] = [];
	doc.on('update', (update: Uint8Array, origin: unknown) => {
		if (origin !== provider) sent.push(update);
	});
	return { store, doc, provider, sent, workspaceId, close };
}

const titles = (store: IssueStore) => store.all.map((issue) => issue.title).sort();

/** Lets y-indexeddb commit what it has been handed, then opens the same workspace again. */
async function reload(workspace: Awaited<ReturnType<typeof open>>) {
	await new Promise((resolve) => setTimeout(resolve, 100));
	workspace.close();
	return open(workspace.workspaceId);
}

function plant(doc: Y.Doc, origin: unknown) {
	peerWrites(
		doc,
		(issues) => {
			const yIssue = wellFormedIssue({ title: 'Innocent' });
			issues.set(REAL_ID, yIssue);
			nestMaps(yIssue, 'zzz', DEPTH);
		},
		origin
	);
}

describe('a store holding an issue with a deep chain of nested types', () => {
	it('shows the row, deletes it, and loads again afterwards', async () => {
		const first = await open();
		first.store.create({ title: 'Kept' });
		plant(first.doc, first.provider);
		expect(titles(first.store)).toEqual(['Innocent', 'Kept']);

		expect(() => first.store.remove(REAL_ID)).not.toThrow();
		expect(titles(first.store)).toEqual(['Kept']);

		const second = await reload(first);
		expect(second.store.persisted).toBe(true);
		expect(titles(second.store)).toEqual(['Kept']);
		second.store.create({ title: 'Next' });
		expect(titles(second.store)).toEqual(['Kept', 'Next']);
	});

	it('lets a field holding the chain be edited, and loads again afterwards', async () => {
		const first = await open();
		plant(first.doc, first.provider);
		peerWrites(
			first.doc,
			(issues) => {
				const yIssue = issues.get(REAL_ID) as Y.Map<unknown>;
				nestMaps(yIssue, 'title', DEPTH);
			},
			first.provider
		);

		expect(() => first.store.update(REAL_ID, { title: 'Repaired' })).not.toThrow();
		expect(titles(first.store)).toEqual(['Repaired']);

		const second = await reload(first);
		expect(titles(second.store)).toEqual(['Repaired']);
	});

	it('takes the delete back on undo and stays loadable', async () => {
		const first = await open();
		plant(first.doc, first.provider);
		first.store.remove(REAL_ID);
		expect(titles(first.store)).toEqual([]);

		expect(first.store.undo()).toBe(true);
		expect(titles(first.store)).toEqual(['Innocent']);

		const second = await reload(first);
		expect(titles(second.store)).toEqual(['Innocent']);
	});

	it('sends a collaborator a delete their browser can apply, live and after a reload', async () => {
		const victim = await open();
		plant(victim.doc, victim.provider);
		const other = await open();
		Y.applyUpdate(other.doc, Y.encodeStateAsUpdate(victim.doc), other.provider);
		other.store.create({ title: 'Others own' });
		expect(titles(other.store)).toEqual(['Innocent', 'Others own']);

		victim.store.remove(REAL_ID);

		expect(victim.sent.length).toBeGreaterThan(0);
		for (const update of victim.sent) {
			expect(() => Y.applyUpdate(other.doc, update, other.provider)).not.toThrow();
		}
		expect(titles(other.store)).toEqual(['Others own']);

		const reloaded = await reload(other);
		expect(titles(reloaded.store)).toEqual(['Others own']);
	});

	it('leaves no ghost row when a peer delivers the chain and its delete in one update', async () => {
		const first = await open();
		first.store.create({ title: 'Kept' });
		const peer = new Y.Doc();
		Y.applyUpdate(peer, Y.encodeStateAsUpdate(first.doc));
		const since = Y.encodeStateVector(peer);
		const yIssue = wellFormedIssue({ title: 'Innocent' });
		getIssuesMap(peer).set(REAL_ID, yIssue);
		nestMaps(yIssue, 'zzz', DEPTH);
		const deleted = treeAndItsDelete(peer, since);

		expect(() => Y.applyUpdate(first.doc, deleted, first.provider)).not.toThrow();
		expect(titles(first.store)).toEqual(['Kept']);

		const second = await reload(first);
		expect(titles(second.store)).toEqual(['Kept']);
	});

	it('loads a database that already holds what used to hang it', async () => {
		const workspaceId = `deep-${crypto.randomUUID()}`;
		const peer = new Y.Doc();
		const since = Y.encodeStateVector(peer);
		const yIssue = wellFormedIssue({ title: 'Innocent' });
		getIssuesMap(peer).set(REAL_ID, yIssue);
		nestMaps(yIssue, 'zzz', DEPTH);
		const deleted = treeAndItsDelete(peer, since);
		// Into the database as bytes, as the half-finished update of an earlier visit got there.
		const empty = new Y.Doc();
		const persistence = attachPersistence(empty, workspaceId);
		await persistence.whenSynced;
		const db = persistence.provider?.db as IDBDatabase;
		await new Promise((resolve, reject) => {
			const transaction = db.transaction('updates', 'readwrite');
			transaction.objectStore('updates').add(deleted);
			transaction.oncomplete = resolve;
			transaction.onerror = reject;
		});
		await persistence.destroy();
		empty.destroy();

		const opened = await open(workspaceId);

		expect(opened.store.persisted).toBe(true);
		expect(titles(opened.store)).toEqual([]);
	});

	it('hands a new collaborator a state their browser can load', async () => {
		const victim = await open();
		victim.store.create({ title: 'Kept' });
		plant(victim.doc, victim.provider);
		victim.store.remove(REAL_ID);

		const replica = new Y.Doc();
		expect(() => Y.applyUpdate(replica, Y.encodeStateAsUpdate(victim.doc))).not.toThrow();
		expect(getIssuesMap(replica).has(REAL_ID)).toBe(false);
	});
});

describe('a store undoing the delete of a chain split across clients', () => {
	it.each([5_000, 10_000])(
		'takes it back whole at %i levels, and has it after a reload',
		async (depth) => {
			const first = await open();
			splitChain(first.doc, depth, first.provider);
			first.store.remove(REAL_ID);
			expect(titles(first.store)).toEqual([]);

			expect(() => first.store.undo()).not.toThrow();

			expect(titles(first.store)).toEqual(['Innocent']);
			expect(first.store.get(REAL_ID)?.description).toBe('Written by the first client');
			const stored = getIssuesMap(first.doc).get(REAL_ID) as Y.Map<unknown>;
			expect(chainUnder(stored)).toEqual({ depth: depth + 1, leaf: 'from the first client' });

			const second = await reload(first);
			expect(second.store.get(REAL_ID)?.description).toBe('Written by the first client');
		}
	);
});

describe('a store handed a plain value nested too deep to write out again', () => {
	/** The value that passes JSON.parse and then overflows JSON.stringify. */
	const frozen = (depth: number) =>
		handWrittenItem(VALUE_CONTENT.json(nestedJson(depth, '{"toJSON":1}')), SLOT_ID);

	it.each([5_120, 20_000])(
		'keeps working at %i levels, shows later writes, and has them after a reload',
		async (depth) => {
			const first = await open();
			first.store.create({ title: 'Kept' });

			expect(() => Y.applyUpdate(first.doc, frozen(depth), first.provider)).not.toThrow();

			first.store.create({ title: 'Mine' });
			expect(titles(first.store)).toEqual(['Kept', 'Mine']);
			expect(first.sent).toHaveLength(2);
			peerWrites(
				first.doc,
				(issues) => issues.set(REAL_ID, wellFormedIssue({ title: 'Theirs' })),
				first.provider
			);
			expect(titles(first.store)).toEqual(['Kept', 'Mine', 'Theirs']);

			const second = await reload(first);
			expect(second.store.persisted).toBe(true);
			expect(titles(second.store)).toEqual(['Kept', 'Mine', 'Theirs']);
		}
	);

	it('loads a database that already holds it', async () => {
		const workspaceId = `deep-${crypto.randomUUID()}`;
		const empty = new Y.Doc();
		const persistence = attachPersistence(empty, workspaceId);
		await persistence.whenSynced;
		const db = persistence.provider?.db as IDBDatabase;
		await new Promise((resolve, reject) => {
			const transaction = db.transaction('updates', 'readwrite');
			transaction.objectStore('updates').add(frozen(20_000));
			transaction.oncomplete = resolve;
			transaction.onerror = reject;
		});
		await persistence.destroy();
		empty.destroy();

		const opened = await open(workspaceId);
		opened.store.create({ title: 'Mine' });

		expect(titles(opened.store)).toEqual(['Mine']);
	});
});
