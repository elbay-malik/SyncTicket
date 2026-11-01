// A peer can nest types as deep as it likes for about 12 bytes a level, and the update integrates
// without a murmur. Yjs then walked that tree recursively whenever part of it was deleted or
// collected, so one such write made Delete throw halfway through, made the half-finished update
// throw out of Y.applyUpdate on everyone else, and made the workspace unloadable afterwards.
// patches/yjs@*.patch makes those two walks iterative. Everything here goes through real
// updates, because a throw inside Y.applyUpdate is exactly what a local map.set would not show.

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
	REAL_ID,
	nestMaps,
	peerWrites,
	treeAndItsDelete,
	wellFormedIssue
} from './junk-entries.fixture.js';
import { createDoc, getIssuesMap } from './doc.js';
import {
	createIssue,
	deleteIssue,
	moveIssue,
	patchIssue,
	readAllIssues,
	readIssue
} from './issues.js';

/** Past Chromium's and Node's limit (about 2,500 levels), and well past it. */
const DEPTHS = [3_000, 50_000];

/** A document holding one ordinary issue beside the poisoned one, and that one's handle. */
function poisoned(depth: number, field = 'zzz') {
	const doc = createDoc();
	const map = getIssuesMap(doc);
	const keptId = createIssue(map, { title: 'Kept' });
	peerWrites(doc, (issues) => {
		issues.set(REAL_ID, wellFormedIssue({ title: 'Innocent', order: 'a1' }));
		nestMaps(issues.get(REAL_ID) as Y.Map<unknown>, field, depth);
	});
	return { doc, map, keptId, yIssue: map.get(REAL_ID) as Y.Map<unknown> };
}

/** What a second browser ends up with, starting from nothing. */
function freshReplica(from: Y.Doc): Y.Doc {
	const replica = createDoc();
	Y.applyUpdate(replica, Y.encodeStateAsUpdate(from));
	return replica;
}

const titles = (doc: Y.Doc) =>
	readAllIssues(getIssuesMap(doc))
		.map((issue) => issue.title)
		.sort();

describe.each(DEPTHS)('a chain of %i nested maps', (depth) => {
	it('integrates and reads as the ordinary issue it sits in', () => {
		const { doc, map } = poisoned(depth);
		expect(titles(doc)).toEqual(['Innocent', 'Kept']);
		expect(readIssue(REAL_ID, map.get(REAL_ID) as Y.Map<unknown>).title).toBe('Innocent');
	});

	it('does not stop the issue being deleted', () => {
		const { doc, map } = poisoned(depth);

		expect(() => deleteIssue(map, REAL_ID)).not.toThrow();

		expect(titles(doc)).toEqual(['Kept']);
		expect(titles(freshReplica(doc))).toEqual(['Kept']);
	});

	it('delivers that delete to a collaborator without throwing there', () => {
		const { doc, map } = poisoned(depth);
		const other = freshReplica(doc);
		const sent: Uint8Array[] = [];
		doc.on('update', (update: Uint8Array) => sent.push(update));

		deleteIssue(map, REAL_ID);

		expect(sent.length).toBeGreaterThan(0);
		for (const update of sent) expect(() => Y.applyUpdate(other, update)).not.toThrow();
		expect(titles(other)).toEqual(['Kept']);
		expect(titles(freshReplica(other))).toEqual(['Kept']);
	});

	it('does not stop a field holding it being replaced', () => {
		const { doc, map, yIssue } = poisoned(depth, 'title');
		expect(readIssue(REAL_ID, yIssue).title).toBe('Untitled');

		expect(() => patchIssue(map, REAL_ID, { title: 'Renamed' })).not.toThrow();

		expect(readIssue(REAL_ID, yIssue).title).toBe('Renamed');
		expect(titles(freshReplica(doc))).toEqual(['Kept', 'Renamed']);
	});

	it.each([
		{ field: 'order', status: 'todo' as const },
		{ field: 'status', status: 'done' as const }
	])('does not stop a move writing over it in $field', ({ field, status }) => {
		const { doc, map, keptId, yIssue } = poisoned(depth, field);

		expect(() => moveIssue(map, REAL_ID, status, [keptId, REAL_ID])).not.toThrow();

		expect(readIssue(REAL_ID, yIssue).status).toBe(status);
		expect(typeof yIssue.get(field)).toBe('string');
		expect(titles(freshReplica(doc))).toEqual(['Innocent', 'Kept']);
	});

	it('leaves no ghost when a peer sends the chain and its delete together', () => {
		const target = createDoc();
		createIssue(getIssuesMap(target), { title: 'Kept' });
		const peer = createDoc();
		Y.applyUpdate(peer, Y.encodeStateAsUpdate(target));
		const issues = getIssuesMap(peer);
		const since = Y.encodeStateVector(peer);
		issues.set(REAL_ID, wellFormedIssue({ title: 'Innocent' }));
		nestMaps(issues.get(REAL_ID) as Y.Map<unknown>, 'zzz', depth);
		const whole = treeAndItsDelete(peer, since);

		expect(() => Y.applyUpdate(target, whole)).not.toThrow();

		expect(titles(target)).toEqual(['Kept']);
		expect(titles(freshReplica(target))).toEqual(['Kept']);
	});

	it.each([
		{ arrival: 'after', order: (chain: Uint8Array, plain: Uint8Array) => [chain, plain] },
		{ arrival: 'before', order: (chain: Uint8Array, plain: Uint8Array) => [plain, chain] }
	])('loses to a concurrent write to the same field arriving $arrival it', ({ order }) => {
		const doc = createDoc();
		peerWrites(doc, (issues) => issues.set(REAL_ID, wellFormedIssue({ title: 'Innocent' })));
		const replica = () => {
			const peer = freshReplica(doc);
			return { peer, yIssue: getIssuesMap(peer).get(REAL_ID) as Y.Map<unknown> };
		};
		// Last-writer-wins goes to the higher client id, so the chain is the one that gets deleted.
		const chain = replica();
		chain.peer.clientID = 1;
		nestMaps(chain.yIssue, 'zzz', depth);
		const rival = replica();
		rival.peer.clientID = 2;
		rival.yIssue.set('zzz', 'plain');
		const since = Y.encodeStateVector(doc);

		for (const update of order(
			Y.encodeStateAsUpdate(chain.peer, since),
			Y.encodeStateAsUpdate(rival.peer, since)
		)) {
			expect(() => Y.applyUpdate(doc, update)).not.toThrow();
		}

		const stored = getIssuesMap(doc).get(REAL_ID) as Y.Map<unknown>;
		expect(stored.get('zzz')).toBe('plain');
		expect(titles(freshReplica(doc))).toEqual(['Innocent']);
	});

	it('does not care which kind of type the chain is made of', () => {
		const doc = createDoc();
		const map = getIssuesMap(doc);
		peerWrites(doc, (issues) => {
			const yIssue = wellFormedIssue({ title: 'Innocent' });
			issues.set(REAL_ID, yIssue);
			const top = new Y.Array<unknown>();
			yIssue.set('zzz', top);
			let current = top;
			(issues.doc as Y.Doc).transact(() => {
				for (let level = 1; level < depth; level += 1) {
					const next = new Y.Array<unknown>();
					current.push([next]);
					current = next;
				}
			});
		});

		expect(() => deleteIssue(map, REAL_ID)).not.toThrow();
		expect(titles(freshReplica(doc))).toEqual([]);
	});

	it('is just as harmless outside `issues`, where no read would ever look', () => {
		const doc = createDoc();
		createIssue(getIssuesMap(doc), { title: 'Kept' });
		peerWrites(doc, (issues) => {
			const other = (issues.doc as Y.Doc).getMap<unknown>('not-issues');
			nestMaps(other, 'zzz', depth);
		});

		const replica = freshReplica(doc);
		expect(() => doc.getMap<unknown>('not-issues').delete('zzz')).not.toThrow();
		const sent = Y.encodeStateAsUpdate(doc, Y.encodeStateVector(replica));
		expect(() => Y.applyUpdate(replica, sent)).not.toThrow();
		expect(titles(replica)).toEqual(['Kept']);
	});
});

describe('what the patch must not change', () => {
	it('still deletes everything under a shallow nested type, once, and tells observers', () => {
		const doc = createDoc();
		const map = getIssuesMap(doc);
		peerWrites(doc, (issues) => {
			const yIssue = wellFormedIssue({ title: 'Nested' });
			issues.set(REAL_ID, yIssue);
			const array = new Y.Array<unknown>();
			yIssue.set('a', array);
			array.push([new Y.Map([['k', 'v']]), 'scalar', new Y.Text('text')]);
			yIssue.set('m', new Y.Map([['inner', new Y.Map([['k', 'v']])]]));
		});
		const events = vi.fn();
		map.observeDeep(events);

		const stateBefore = Y.encodeStateVector(doc);
		deleteIssue(map, REAL_ID);

		expect(events).toHaveBeenCalledTimes(1);
		expect(events.mock.calls[0]?.[0]).toHaveLength(1);
		expect(map.has(REAL_ID)).toBe(false);
		// A delete writes no new structs, only a delete set.
		expect(Y.encodeStateVector(doc)).toEqual(stateBefore);
		expect(titles(freshReplica(doc))).toEqual([]);
		// Collected: an entry's nested types leave nothing a fresh replica has to integrate.
		const yIssueBytes = Y.encodeStateAsUpdate(doc).byteLength;
		expect(yIssueBytes).toBeLessThan(200);
	});

	it('leaves concurrent edits to a deleted subtree deleted, whichever arrives first', () => {
		const doc = createDoc();
		const map = getIssuesMap(doc);
		peerWrites(doc, (issues) => {
			issues.set(REAL_ID, wellFormedIssue({ title: 'Nested', zzz: new Y.Map([['k', 'v']]) }));
		});
		const peer = freshReplica(doc);
		const peerNested = (getIssuesMap(peer).get(REAL_ID) as Y.Map<unknown>).get(
			'zzz'
		) as Y.Map<unknown>;
		peerNested.set('k2', new Y.Map([['deep', 'x']]));

		deleteIssue(map, REAL_ID);
		const deletion = Y.encodeStateAsUpdate(doc);
		Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
		Y.applyUpdate(peer, deletion);

		expect(titles(doc)).toEqual([]);
		expect(titles(peer)).toEqual([]);
		expect(Y.encodeStateVector(doc)).toEqual(Y.encodeStateVector(peer));
	});

	it('undoes the delete of a nested issue through an UndoManager, and redoes it', () => {
		const doc = createDoc();
		const map = getIssuesMap(doc);
		const undo = new Y.UndoManager(map, { captureTimeout: 0 });
		peerWrites(doc, (issues) => {
			issues.set(REAL_ID, wellFormedIssue({ title: 'Nested' }));
			nestMaps(issues.get(REAL_ID) as Y.Map<unknown>, 'zzz', 3_000);
		});

		deleteIssue(map, REAL_ID);
		expect(titles(doc)).toEqual([]);
		expect(undo.canUndo()).toBe(true);

		expect(() => undo.undo()).not.toThrow();
		expect(titles(doc)).toEqual(['Nested']);
		expect(() => undo.redo()).not.toThrow();
		expect(titles(doc)).toEqual([]);
		expect(titles(freshReplica(doc))).toEqual([]);
		undo.destroy();
	});
});
