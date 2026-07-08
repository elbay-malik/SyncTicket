import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { sortIssues } from '$lib/model/query.js';
import type { YIssue } from './doc.js';
import { createDoc, getIssuesMap } from './doc.js';
import { createIssue, deleteIssue, patchIssue, readAllIssues, readIssue } from './issues.js';

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
		// Concurrent first-creates mint identical order keys ("a0" on both), and Y.Map
		// iteration order isn't stable across replicas — so display order must converge via
		// the sort's id tiebreak, not the fractional key alone.
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
});
