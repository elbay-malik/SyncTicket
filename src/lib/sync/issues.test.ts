import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { sortIssues } from '$lib/model/query.js';
import type { YIssue } from './doc.js';
import { createDoc, getIssuesMap } from './doc.js';
import {
	createIssue,
	deleteIssue,
	moveIssue,
	patchIssue,
	readAllIssues,
	readIssue
} from './issues.js';

function read(map: Y.Map<YIssue>, id: string) {
	const yIssue = map.get(id);
	if (!yIssue) throw new Error(`missing issue ${id}`);
	return readIssue(id, yIssue);
}

describe('issue CRDT helpers', () => {
	it('creates an issue and reads it back with defaults', () => {
		const map = getIssuesMap(createDoc());
		const id = createIssue(map, { title: '  Fix login  ' });
		const issue = read(map, id);
		expect(issue.title).toBe('Fix login'); // trimmed
		expect(issue.status).toBe('backlog');
		expect(issue.priority).toBe('none');
		expect(issue.assignee).toBeNull();
		expect(issue.labels).toEqual([]);
		expect(issue.order).not.toBe('');
		expect(issue.createdAt).toBeGreaterThan(0);
		expect(issue.updatedAt).toBe(issue.createdAt);
	});

	it('defaults a blank title to Untitled', () => {
		const map = getIssuesMap(createDoc());
		const id = createIssue(map, { title: '   ' });
		expect(read(map, id).title).toBe('Untitled');
	});

	it('assigns strictly increasing, unique order keys on append', () => {
		const map = getIssuesMap(createDoc());
		const ids = [
			createIssue(map, { title: 'a' }),
			createIssue(map, { title: 'b' }),
			createIssue(map, { title: 'c' })
		];
		const orders = ids.map((id) => read(map, id).order);
		expect(orders).toEqual([...orders].sort());
		expect(new Set(orders).size).toBe(3);
	});

	it('patches fields and never moves updatedAt backwards', async () => {
		const map = getIssuesMap(createDoc());
		const id = createIssue(map, { title: 'x' });
		const before = read(map, id);
		await new Promise((resolve) => setTimeout(resolve, 2));
		patchIssue(map, id, { status: 'in_progress', priority: 'high' });
		const after = read(map, id);
		expect(after.status).toBe('in_progress');
		expect(after.priority).toBe('high');
		expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
	});

	it('drops fields whose value is unchanged, leaving updatedAt alone', async () => {
		// A picker re-selecting the current status must not cost a CRDT write: it would bump
		// updatedAt (reshuffling the "recent" sort) and, from Phase 9, hit the relay.
		const map = getIssuesMap(createDoc());
		const id = createIssue(map, { title: 'x', status: 'todo', labels: ['bug'] });
		const before = read(map, id);
		await new Promise((resolve) => setTimeout(resolve, 2));
		patchIssue(map, id, { status: 'todo', labels: ['bug'], title: 'x' });
		expect(read(map, id).updatedAt).toBe(before.updatedAt);

		// A patch mixing a changed and an unchanged field still applies the changed one.
		patchIssue(map, id, { status: 'todo', priority: 'high' });
		const after = read(map, id);
		expect(after.priority).toBe('high');
		expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
	});

	it('trims a patched title and ignores a blank one', () => {
		// readIssue only defaults a *missing* title, so a persisted '' would render forever.
		const map = getIssuesMap(createDoc());
		const id = createIssue(map, { title: 'Original' });
		patchIssue(map, id, { title: '   ' });
		expect(read(map, id).title).toBe('Original');
		patchIssue(map, id, { title: '  Renamed  ' });
		expect(read(map, id).title).toBe('Renamed');
	});

	it('ignores patches to a missing issue', () => {
		const map = getIssuesMap(createDoc());
		expect(() => patchIssue(map, 'ghost', { title: 'nope' })).not.toThrow();
		expect(readAllIssues(map)).toHaveLength(0);
	});

	it('deletes an issue', () => {
		const map = getIssuesMap(createDoc());
		const id = createIssue(map, { title: 'temp' });
		expect(map.has(id)).toBe(true);
		deleteIssue(map, id);
		expect(map.has(id)).toBe(false);
		expect(readAllIssues(map)).toHaveLength(0);
	});

	it('tolerates corrupt fields when reading', () => {
		const doc = createDoc();
		const map = getIssuesMap(doc);
		const yIssue = new Y.Map<unknown>();
		doc.transact(() => {
			map.set('corrupt', yIssue);
			yIssue.set('title', 123); // wrong type
			yIssue.set('status', 'not-a-status');
			yIssue.set('labels', ['ok', 7, 'fine']);
		});
		const issue = read(map, 'corrupt');
		expect(issue.title).toBe('Untitled');
		expect(issue.status).toBe('backlog');
		expect(issue.labels).toEqual(['ok', 'fine']);
	});

	it('merges two offline replicas without conflict', () => {
		// Core CRDT guarantee: concurrent creates on disconnected docs both survive a merge.
		const docA = createDoc();
		const docB = createDoc();
		createIssue(getIssuesMap(docA), { title: 'from A' });
		createIssue(getIssuesMap(docB), { title: 'from B' });

		Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
		Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

		const titlesA = readAllIssues(getIssuesMap(docA))
			.map((i) => i.title)
			.sort();
		const titlesB = readAllIssues(getIssuesMap(docB))
			.map((i) => i.title)
			.sort();
		expect(titlesA).toEqual(['from A', 'from B']);
		expect(titlesA).toEqual(titlesB);
	});

	it('two replicas render concurrently-created issues in the same order', () => {
		// Y.Map iteration order isn't stable across replicas, so display order must come from
		// the sort. Order keys now carry a random suffix (see order.ts), which is what stops
		// two offline replicas minting the same "a0"; the id tiebreak still backstops it.
		const docA = createDoc();
		const docB = createDoc();
		createIssue(getIssuesMap(docA), { title: 'from A' });
		createIssue(getIssuesMap(docB), { title: 'from B' });
		Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
		Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

		const idsA = sortIssues(readAllIssues(getIssuesMap(docA)), 'manual').map((i) => i.id);
		const idsB = sortIssues(readAllIssues(getIssuesMap(docB)), 'manual').map((i) => i.id);
		expect(idsA).toEqual(idsB);
	});

	it('gives concurrently-created issues distinct order keys across replicas', () => {
		// The Phase 5 hazard: identical keys make a later drag between them throw.
		const docA = createDoc();
		const docB = createDoc();
		createIssue(getIssuesMap(docA), { title: 'from A' });
		createIssue(getIssuesMap(docB), { title: 'from B' });
		Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

		const orders = readAllIssues(getIssuesMap(docA)).map((issue) => issue.order);
		expect(new Set(orders).size).toBe(2);
	});
});

describe('moveIssue', () => {
	/** Ids of `status`'s column in display order. */
	function column(map: Y.Map<YIssue>, status: string): string[] {
		return sortIssues(
			readAllIssues(map).filter((issue) => issue.status === status),
			'manual'
		).map((issue) => issue.id);
	}

	it('reorders within a column', () => {
		const map = getIssuesMap(createDoc());
		const a = createIssue(map, { title: 'a', status: 'todo' });
		const b = createIssue(map, { title: 'b', status: 'todo' });
		const c = createIssue(map, { title: 'c', status: 'todo' });
		expect(column(map, 'todo')).toEqual([a, b, c]);

		// Drag the last card to the front.
		moveIssue(map, c, 'todo', [c, a, b]);
		expect(column(map, 'todo')).toEqual([c, a, b]);

		// And back to the middle.
		moveIssue(map, c, 'todo', [a, c, b]);
		expect(column(map, 'todo')).toEqual([a, c, b]);
	});

	it('moves between columns, setting status and position together', () => {
		const map = getIssuesMap(createDoc());
		const a = createIssue(map, { title: 'a', status: 'todo' });
		const b = createIssue(map, { title: 'b', status: 'done' });
		const c = createIssue(map, { title: 'c', status: 'done' });

		moveIssue(map, a, 'done', [b, a, c]);
		expect(read(map, a).status).toBe('done');
		expect(column(map, 'done')).toEqual([b, a, c]);
		expect(column(map, 'todo')).toEqual([]);
	});

	it('drops into an empty column', () => {
		const map = getIssuesMap(createDoc());
		const a = createIssue(map, { title: 'a', status: 'todo' });
		moveIssue(map, a, 'in_progress', [a]);
		expect(read(map, a).status).toBe('in_progress');
		expect(column(map, 'in_progress')).toEqual([a]);
	});

	it('does not bump updatedAt for a pure reorder, but does for a status change', async () => {
		const map = getIssuesMap(createDoc());
		const a = createIssue(map, { title: 'a', status: 'todo' });
		const b = createIssue(map, { title: 'b', status: 'todo' });
		const before = read(map, a).updatedAt;
		await new Promise((resolve) => setTimeout(resolve, 2));

		moveIssue(map, a, 'todo', [b, a]);
		expect(read(map, a).updatedAt).toBe(before);

		moveIssue(map, a, 'done', [a]);
		expect(read(map, a).updatedAt).toBeGreaterThan(before);
	});

	it('drops between two issues that were created concurrently offline', () => {
		// Both replicas mint a key for their first issue; after a merge the column can hold
		// duplicates, and generateKeyBetween throws on equal bounds. The move must repair.
		const doc = createDoc();
		const map = getIssuesMap(doc);
		const a = createIssue(map, { title: 'a', status: 'todo' });
		const b = createIssue(map, { title: 'b', status: 'todo' });
		const dragged = createIssue(map, { title: 'dragged', status: 'todo' });
		// Force the exact collision the roadmap warns about.
		doc.transact(() => {
			map.get(a)?.set('order', 'a0');
			map.get(b)?.set('order', 'a0');
		});

		expect(() => moveIssue(map, dragged, 'todo', [a, dragged, b])).not.toThrow();
		const orders = readAllIssues(map).map((issue) => issue.order);
		expect(new Set(orders).size).toBe(3);
		expect(column(map, 'todo')).toEqual([a, dragged, b]);
	});

	it('ignores a missing issue or an id absent from the target order', () => {
		const map = getIssuesMap(createDoc());
		const a = createIssue(map, { title: 'a', status: 'todo' });
		expect(() => moveIssue(map, 'ghost', 'todo', ['ghost'])).not.toThrow();
		expect(() => moveIssue(map, a, 'done', [])).not.toThrow();
		expect(read(map, a).status).toBe('todo');
	});

	it('writes nothing when a card is dropped back where it started', () => {
		// Dropping in place, or abandoning a drag outside every column, still fires a drop
		// event. Jitter means the recomputed key always differs from the stored one, so the
		// guard has to ask whether the existing key still sorts correctly, not whether it
		// matches.
		const doc = createDoc();
		const map = getIssuesMap(doc);
		const a = createIssue(map, { title: 'a', status: 'todo' });
		const b = createIssue(map, { title: 'b', status: 'todo' });
		const c = createIssue(map, { title: 'c', status: 'todo' });

		let updates = 0;
		doc.on('update', () => (updates += 1));
		moveIssue(map, b, 'todo', [a, b, c]); // exactly where it already is
		expect(updates).toBe(0);

		// A real move still writes.
		moveIssue(map, b, 'todo', [b, a, c]);
		expect(updates).toBe(1);
	});

	it('drags a card whose order field is missing without throwing', () => {
		// readIssue tolerates a missing `order` by reporting '', which is not a valid key.
		const doc = createDoc();
		const map = getIssuesMap(doc);
		const a = createIssue(map, { title: 'a', status: 'todo' });
		const b = createIssue(map, { title: 'b', status: 'todo' });
		doc.transact(() => map.get(a)?.delete('order'));
		expect(read(map, a).order).toBe('');

		expect(() => moveIssue(map, b, 'todo', [b, a])).not.toThrow();
		expect(read(map, a).order).not.toBe('');
		expect(column(map, 'todo')).toEqual([b, a]);
	});
});
