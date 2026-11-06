// Undo after a peer has overwritten the step on top of the stack. Yjs refuses to restore over a
// newer value from another client, so that step changes nothing, and left to itself Yjs pops the
// next one in the same call. One press aimed at a title then deleted the issue, or every example
// issue, for everyone. Everything here arrives as real updates from a separate document.

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { getIssuesMap } from '$lib/sync/doc.js';
import { createIssue, patchIssue } from '$lib/sync/issues.js';
import { IssueStore } from './issues.svelte.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length) cleanups.pop()?.();
});

async function open() {
	const provider = { fake: 'relay provider' };
	let attached = null as Y.Doc | null;
	const store = new IssueStore(`undo-overwritten-${crypto.randomUUID()}`, {
		attachRelay: (doc) => {
			attached = doc;
			const awareness = new Awareness(doc);
			clearInterval(awareness._checkInterval);
			return { provider: provider as never, awareness, destroy: () => awareness.destroy() };
		}
	});
	cleanups.push(() => store.destroy());
	await vi.waitFor(() => expect(store.synced).toBe(true), { timeout: 4_000 });
	const doc = attached as unknown as Y.Doc;
	/** A peer who has seen everything so far writes something, and that reaches the store. */
	const fromPeer = <T>(write: (peer: Y.Doc) => T): T => {
		const peer = new Y.Doc();
		Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
		const since = Y.encodeStateVector(doc);
		const result = write(peer);
		Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, since), provider);
		peer.destroy();
		return result;
	};
	const peerCreates = (title: string) =>
		fromPeer((peer) => createIssue(getIssuesMap(peer), { title }));
	const peerRenames = (id: string, title: string) =>
		fromPeer((peer) => patchIssue(getIssuesMap(peer), id, { title }));
	return { store, peerCreates, peerRenames };
}

describe('undo when a peer overwrote the last step', () => {
	it('does not delete the issue the step was made on', async () => {
		const { store, peerRenames } = await open();
		const id = store.create({ title: 'Original' });
		store.update(id, { title: 'Mine' }, store.beginEdit());
		peerRenames(id, 'Theirs');

		store.undo();

		expect(store.get(id)?.title).toBe('Theirs');
	});

	it('does not take back every example issue', async () => {
		const { store, peerRenames } = await open();
		store.seedDemo();
		const count = store.all.length;
		const id = store.all[0]!.id;
		store.update(id, { title: 'Mine' }, store.beginEdit());
		peerRenames(id, 'Theirs');

		store.undo();

		expect(store.all).toHaveLength(count);
	});

	it('does not reach an unrelated issue', async () => {
		const { store, peerRenames } = await open();
		const unrelated = store.create({ title: 'Unrelated' });
		const shared = store.create({ title: 'Shared' });
		store.update(shared, { title: 'Mine' }, store.beginEdit());
		store.update(unrelated, { status: 'done' }, store.beginEdit());
		store.update(shared, { title: 'Mine again' }, store.beginEdit());
		peerRenames(shared, 'Theirs');

		store.undo();

		expect(store.get(unrelated)?.status).toBe('done');
	});

	it('leaves the earlier steps for the next press, and says so', async () => {
		const { store, peerRenames } = await open();
		const id = store.create({ title: 'Original' });
		store.update(id, { title: 'Mine' }, store.beginEdit());
		peerRenames(id, 'Theirs');

		store.undo();
		expect(store.canUndo).toBe(true);

		store.undo();
		expect(store.get(id)).toBeUndefined();
		expect(store.canUndo).toBe(false);
	});

	it('turns the control off when that was the only step', async () => {
		const { store, peerCreates, peerRenames } = await open();
		const id = peerCreates('Theirs from the start');
		store.update(id, { title: 'Mine' }, store.beginEdit());
		peerRenames(id, 'Theirs');
		expect(store.canUndo).toBe(true);

		expect(store.undo()).toBe(true);

		expect(store.canUndo).toBe(false);
		expect(store.get(id)?.title).toBe('Theirs');
	});
});

describe('a write straight after a step that changed nothing', () => {
	it('stays a step of its own instead of joining the older step below', async () => {
		const { store, peerRenames } = await open();
		const id = store.create({ title: 'Original' });
		store.update(id, { status: 'done' }, store.beginEdit());
		store.update(id, { title: 'Mine' });
		peerRenames(id, 'Theirs');
		store.undo();

		store.update(id, { assignee: 'Ada' });
		store.undo();

		expect(store.get(id)?.assignee).not.toBe('Ada');
		expect(store.get(id)?.status).toBe('done');
	});
});

describe('Escape when a peer overwrote the run', () => {
	it('keeps the issue, under the title the peer gave it', async () => {
		const { store, peerRenames } = await open();
		const id = store.create({ title: 'Original' });
		const run = store.beginEdit();
		store.update(id, { title: 'Mine' }, run);
		peerRenames(id, 'Theirs');

		expect(store.revertEdit(run)).toBe(true);

		expect(store.get(id)?.title).toBe('Theirs');
		expect(store.canUndo).toBe(true);
	});

	it('still reverts a run nobody overwrote', async () => {
		const { store } = await open();
		const id = store.create({ title: 'Original' });
		const run = store.beginEdit();
		store.update(id, { title: 'Mine' }, run);

		expect(store.revertEdit(run)).toBe(true);

		expect(store.get(id)?.title).toBe('Original');
	});
});

describe('redo when a peer overwrote the step', () => {
	it('does not reapply a later step in its place', async () => {
		const { store, peerRenames } = await open();
		const id = store.create({ title: 'Original' });
		store.update(id, { title: 'Mine' }, store.beginEdit());
		store.update(id, { status: 'done' }, store.beginEdit());
		const before = store.get(id)?.status;
		store.undo();
		const undone = store.get(id)?.status;
		expect(undone).not.toBe(before);
		store.undo();
		peerRenames(id, 'Theirs');

		store.redo();
		expect(store.get(id)?.status).toBe(undone);
		expect(store.get(id)?.title).toBe('Theirs');
		expect(store.canRedo).toBe(true);

		store.redo();
		expect(store.get(id)?.status).toBe('done');
		expect(store.canRedo).toBe(false);
	});
});

describe('what taking one step at a time must not change', () => {
	it('undoes and redoes ordinary steps in order', async () => {
		const { store } = await open();
		const id = store.create({ title: 'Original' });
		store.update(id, { title: 'First' }, store.beginEdit());
		store.update(id, { title: 'Second' }, store.beginEdit());

		store.undo();
		expect(store.get(id)?.title).toBe('First');
		store.undo();
		expect(store.get(id)?.title).toBe('Original');
		expect(store.canUndo).toBe(true);
		expect(store.canRedo).toBe(true);

		store.redo();
		expect(store.canRedo).toBe(true);
		store.redo();
		expect(store.get(id)?.title).toBe('Second');
		expect(store.canRedo).toBe(false);
	});
});
