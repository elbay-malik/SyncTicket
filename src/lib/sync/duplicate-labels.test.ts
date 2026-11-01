// Labels a peer can store, delivered from another replica. The UI dedupes what it writes through
// parseLabels, but the CRDT does not, and a repeated string under a keyed {#each} throws
// each_key_duplicate in production too. The rendered half is in
// components/issues/duplicate-labels.svelte.test.ts.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { parseLabels } from '$lib/model/labels.js';
import { createDoc, getIssuesMap, getYIssue } from './doc.js';
import { createIssue, patchIssue, readAllIssues, readIssue } from './issues.js';
import { peerWrites } from './junk-entries.fixture.js';

function makeWorkspace(labels: string[] = []) {
	const doc = createDoc();
	const map = getIssuesMap(doc);
	const id = createIssue(map, { title: 'Fix login', labels });
	return { doc, map, id };
}

/** What a peer's write leaves in the document, and what every reader gets from it. */
function deliver(labels: unknown) {
	const workspace = makeWorkspace();
	const { doc, map, id } = workspace;
	peerWrites(doc, (issues) => (issues.get(id) as Y.Map<unknown>).set('labels', labels));
	const yIssue = getYIssue(map, id) as Y.Map<unknown>;
	return { ...workspace, yIssue, read: readIssue(id, yIssue).labels };
}

describe('labels a peer repeats', () => {
	it.each([
		{ name: 'the audit’s exploit', labels: ['a', 'a'], read: ['a'] },
		{ name: 'first occurrence wins', labels: ['b', 'a', 'b', 'a', 'c'], read: ['b', 'a', 'c'] },
		{ name: 'many of one', labels: Array(50).fill('a'), read: ['a'] },
		{ name: 'an empty string twice', labels: ['', ''], read: [''] },
		{ name: 'repeats around things that are not strings', labels: [1, 'a', null, 'a'], read: ['a'] }
	])('reads one of each: $name', ({ labels, read }) => {
		expect(deliver(labels).read).toEqual(read);
	});

	it('is case-sensitive and does not trim, exactly as parseLabels compares', () => {
		expect(deliver(['Bug', 'bug', 'BUG', ' bug', 'bug']).read).toEqual([
			'Bug',
			'bug',
			'BUG',
			' bug'
		]);
		expect(parseLabels('Bug, bug, Bug')).toEqual(['Bug', 'bug']);
	});

	it('leaves distinct labels alone, in their order', () => {
		expect(deliver(['c', 'a', 'b']).read).toEqual(['c', 'a', 'b']);
	});

	it('does not cap them, because size limits are a separate decision', () => {
		const many = Array.from({ length: 2000 }, (_, i) => `label-${i}`.repeat(50));
		expect(deliver(many).read).toEqual(many);
	});

	it('reads the same through readAllIssues, which is what the store projects', () => {
		const { map } = deliver(['a', 'a']);
		expect(readAllIssues(map).map((issue) => issue.labels)).toEqual([['a']]);
	});

	it('never writes on a read: the repeat stays in the document', () => {
		const { doc, map, id, yIssue } = deliver(['a', 'a']);
		const updates: Uint8Array[] = [];
		doc.on('update', (update: Uint8Array) => updates.push(update));

		readIssue(id, getYIssue(map, id) as Y.Map<unknown>);

		expect(updates).toEqual([]);
		expect(yIssue.get('labels')).toEqual(['a', 'a']);
	});
});

describe('saving over a stored repeat', () => {
	function savedOver(labels: string[], patch: string[]) {
		const workspace = deliver(labels);
		const before = workspace.yIssue.get('updatedAt');
		const updates: Uint8Array[] = [];
		workspace.doc.on('update', (update: Uint8Array) => updates.push(update));
		patchIssue(workspace.map, workspace.id, { labels: patch });
		return { ...workspace, before, updates };
	}

	it('compares equal and writes nothing when the deduped value is what was saved', () => {
		const { updates, yIssue, before, map, id } = savedOver(['a', 'a'], ['a']);

		expect(updates).toEqual([]);
		// Which leaves the repeat in place, and that is fine: every reader sees one.
		expect(yIssue.get('labels')).toEqual(['a', 'a']);
		expect(yIssue.get('updatedAt')).toBe(before);
		expect(readIssue(id, getYIssue(map, id) as Y.Map<unknown>).labels).toEqual(['a']);
	});

	it('replaces the repeat when the save really changes something', () => {
		const { updates, yIssue } = savedOver(['a', 'a'], ['a', 'b']);

		expect(updates).toHaveLength(1);
		expect(yIssue.get('labels')).toEqual(['a', 'b']);
	});

	it('counts removing the only label as a change', () => {
		const { yIssue } = savedOver(['a', 'a'], []);

		expect(yIssue.get('labels')).toEqual([]);
	});
});
