// The store's half of "show me when someone else edits", against a real Y.Doc.
//
// A browser-mode test has no relay, and the rule being tested is *about* the relay: a change
// counts when the relay provider applied it after the two sides were in step. So the store
// is handed a relay this test drives (`attachRelay` is the store's one test seam): a plain
// object stands in as the provider, because the only thing the store asks of it is to be the
// transaction's origin; the awareness is real, because author resolution goes through it.
// The peer is a second Y.Doc whose updates are applied by hand, as the provider would.

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createIdentity, type Identity } from '$lib/model/identity.js';
import { getIssuesMap } from '$lib/sync/doc.js';
import { createIssue, deleteIssue, patchIssue } from '$lib/sync/issues.js';
import type { RelayHandlers } from '$lib/sync/provider.js';
import { IssueStore } from './issues.svelte.js';
import { RemoteActivity } from './remote-activity.svelte.js';
import { TRACE_MS, type RemoteChange } from './remote-change.js';

interface Harness {
	store: IssueStore;
	doc: Y.Doc;
	handlers: RelayHandlers;
	provider: object;
	changes: RemoteChange[];
}

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length) cleanups.pop()?.();
	vi.useRealTimers();
});

async function makeHarness(): Promise<Harness> {
	const provider = { fake: 'relay provider' };
	let captured: { doc: Y.Doc; handlers: RelayHandlers } | null = null;
	const store = new IssueStore(`test-${crypto.randomUUID()}`, {
		attachRelay: (doc, _workspaceId, handlers) => {
			captured = { doc, handlers };
			const awareness = new Awareness(doc);
			clearInterval(awareness._checkInterval);
			return {
				provider: provider as never,
				awareness,
				destroy: () => awareness.destroy()
			};
		}
	});
	cleanups.push(() => store.destroy());
	await vi.waitFor(() => expect(store.synced).toBe(true));
	const changes: RemoteChange[] = [];
	cleanups.push(store.remote.subscribe((change) => changes.push(change)));
	const { doc, handlers } = captured as unknown as { doc: Y.Doc; handlers: RelayHandlers };
	return { store, doc, handlers, provider, changes };
}

interface Peer {
	doc: Y.Doc;
	identity: Identity;
	/** Sends everything the store has not seen yet, as the relay would. */
	send(harness: Harness, origin?: unknown): void;
	/** Announces this peer's presence to the store's awareness. */
	announce(harness: Harness): void;
}

function makePeer(name: string): Peer {
	const doc = new Y.Doc();
	const identity: Identity = { ...createIdentity(), name };
	const awareness = new Awareness(doc);
	clearInterval(awareness._checkInterval);
	awareness.setLocalState({ ...identity, issue: null, t: Date.now() });
	cleanups.push(() => awareness.destroy());
	return {
		doc,
		identity,
		send(harness, origin = harness.provider) {
			const update = Y.encodeStateAsUpdate(doc, Y.encodeStateVector(harness.doc));
			Y.applyUpdate(harness.doc, update, origin);
		},
		announce(harness) {
			applyAwarenessUpdate(
				harness.store.awareness,
				encodeAwarenessUpdate(awareness, [awareness.clientID]),
				'remote'
			);
		}
	};
}

describe('IssueStore remote changes', () => {
	it('does not mark the workspace a visitor receives when they first connect', async () => {
		const harness = await makeHarness();
		const ada = makePeer('Ada Lovelace');
		ada.announce(harness);
		const ids = [1, 2, 3].map((n) => createIssue(getIssuesMap(ada.doc), { title: `Seeded ${n}` }));

		// The relay's SyncStep2: applied by the provider, *before* `synced` is reported.
		ada.send(harness);
		harness.handlers.onSynced(true);

		expect(harness.store.all).toHaveLength(3);
		expect(harness.changes).toEqual([]);
		for (const id of ids) expect(harness.store.remote.get(id)).toBeUndefined();
	});

	it('marks a peer’s status change once live, naming the author with their own hue', async () => {
		const harness = await makeHarness();
		const ada = makePeer('Ada Lovelace');
		ada.announce(harness);
		const id = createIssue(getIssuesMap(ada.doc), { title: 'Fix login redirect' });
		ada.send(harness);
		harness.handlers.onSynced(true);

		patchIssue(getIssuesMap(ada.doc), id, { status: 'done' });
		ada.send(harness);

		const expected = {
			issueId: id,
			kind: 'status',
			title: 'Fix login redirect',
			status: 'done',
			author: { userId: ada.identity.userId, name: 'Ada Lovelace', hue: ada.identity.hue }
		};
		expect(harness.changes).toEqual([expect.objectContaining(expected)]);
		expect(harness.store.remote.get(id)).toEqual(expect.objectContaining(expected));
	});

	it('names each issue’s own author when one update carries two peers’ edits', async () => {
		const harness = await makeHarness();
		harness.handlers.onSynced(true);
		const ada = makePeer('Ada Lovelace');
		const grace = makePeer('Grace Hopper');
		ada.announce(harness);
		grace.announce(harness);
		// Grace's replica receives Ada's issue and adds her own; the store hears both at once.
		const adas = createIssue(getIssuesMap(ada.doc), { title: 'From Ada' });
		Y.applyUpdate(grace.doc, Y.encodeStateAsUpdate(ada.doc));
		const graces = createIssue(getIssuesMap(grace.doc), { title: 'From Grace' });
		grace.send(harness);

		expect(harness.store.remote.get(adas)?.author?.name).toBe('Ada Lovelace');
		expect(harness.store.remote.get(graces)?.author?.name).toBe('Grace Hopper');
		expect(harness.store.remote.get(adas)?.kind).toBe('created');
	});

	it('says nobody in particular when the author has not announced themselves', async () => {
		const harness = await makeHarness();
		harness.handlers.onSynced(true);
		const stranger = makePeer('Unannounced');
		const id = createIssue(getIssuesMap(stranger.doc), { title: 'Anonymous' });
		stranger.send(harness);

		expect(harness.store.remote.get(id)).toEqual(
			expect.objectContaining({ kind: 'created', author: null })
		);
	});

	it('never marks this browser’s own edits, nor undo and redo of them', async () => {
		const harness = await makeHarness();
		harness.handlers.onSynced(true);
		const { store } = harness;
		const id = store.create({ title: 'Mine' });
		store.update(id, { status: 'done' });
		store.undo();
		store.redo();
		store.remove(id);

		expect(harness.changes).toEqual([]);
	});

	it('never marks an update that did not come from the relay', async () => {
		// IndexedDB hydration applies with its own provider as the origin, after `synced` too
		// when the relay happens to answer first.
		const harness = await makeHarness();
		harness.handlers.onSynced(true);
		const ada = makePeer('Ada Lovelace');
		ada.announce(harness);
		createIssue(getIssuesMap(ada.doc), { title: 'From disk' });
		ada.send(harness, { fake: 'indexeddb' });

		expect(harness.store.all).toHaveLength(1);
		expect(harness.changes).toEqual([]);
	});

	it('treats a reconnect’s catch-up as backlog, not news', async () => {
		const harness = await makeHarness();
		harness.handlers.onSynced(true);
		const ada = makePeer('Ada Lovelace');
		ada.announce(harness);
		harness.handlers.onSynced(false);
		createIssue(getIssuesMap(ada.doc), { title: 'Made while we were apart' });
		ada.send(harness);
		harness.handlers.onSynced(true);

		expect(harness.changes).toEqual([]);
	});

	it('announces a deletion without leaving a trace on a row that is gone', async () => {
		const harness = await makeHarness();
		const ada = makePeer('Ada Lovelace');
		ada.announce(harness);
		const id = createIssue(getIssuesMap(ada.doc), { title: 'Doomed' });
		ada.send(harness);
		harness.handlers.onSynced(true);

		deleteIssue(getIssuesMap(ada.doc), id);
		ada.send(harness);

		// Yjs records what was deleted, not by whom, so the author is honestly unknown.
		expect(harness.changes).toEqual([
			expect.objectContaining({ issueId: id, kind: 'deleted', title: 'Doomed', author: null })
		]);
		expect(harness.store.remote.get(id)).toBeUndefined();
	});
});

describe('RemoteActivity', () => {
	const change = (patch: Partial<RemoteChange> = {}): RemoteChange => ({
		issueId: 'i1',
		kind: 'status',
		title: 'Fix login redirect',
		status: 'done',
		author: null,
		at: 0,
		...patch
	});

	it('forgets a change after the trace has run its course', () => {
		vi.useFakeTimers();
		const activity = new RemoteActivity();
		cleanups.push(() => activity.destroy());
		activity.record(change());
		vi.advanceTimersByTime(TRACE_MS - 1);
		expect(activity.get('i1')).toBeDefined();
		vi.advanceTimersByTime(1);
		expect(activity.get('i1')).toBeUndefined();
	});

	it('restarts the clock when the same issue changes again', () => {
		vi.useFakeTimers();
		const activity = new RemoteActivity();
		cleanups.push(() => activity.destroy());
		activity.record(change({ at: 1 }));
		vi.advanceTimersByTime(TRACE_MS - 100);
		activity.record(change({ at: 2, kind: 'edited' }));
		vi.advanceTimersByTime(500);
		// The first change's timer would have fired by now; the second keeps the row marked,
		// as a continuation of the run the first one began.
		expect(activity.get('i1')).toEqual(
			expect.objectContaining({ at: 2, kind: 'edited', since: 1 })
		);
		vi.advanceTimersByTime(TRACE_MS);
		expect(activity.get('i1')).toBeUndefined();
		// Once it has lapsed, the next change starts a run of its own.
		activity.record(change({ at: 3 }));
		expect(activity.get('i1')?.since).toBe(3);
	});

	it('drops a trace when its issue is deleted, and tells subscribers', () => {
		const activity = new RemoteActivity();
		cleanups.push(() => activity.destroy());
		const heard: string[] = [];
		const unsubscribe = activity.subscribe((c) => heard.push(c.kind));
		activity.record(change());
		activity.record(change({ kind: 'deleted' }));
		expect(activity.get('i1')).toBeUndefined();
		unsubscribe();
		activity.record(change());
		expect(heard).toEqual(['status', 'deleted']);
	});
});
