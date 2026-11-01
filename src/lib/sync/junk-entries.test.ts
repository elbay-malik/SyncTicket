// Every read in sync/ against what a peer can actually put under `issues`. The store's half,
// the projection and the load, is in state/junk-entries.svelte.test.ts.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createDoc, getIssuesMap } from './doc.js';
import {
	createIssue,
	deleteIssue,
	moveIssue,
	nextOrderKey,
	patchIssue,
	readAllIssues
} from './issues.js';
import { JUNK_VALUES, peerWrites } from './junk-entries.fixture.js';
import { seedDemoIssues, seedIssues } from './seed.js';

function titles(doc: Y.Doc, status?: string): string[] {
	return readAllIssues(getIssuesMap(doc))
		.filter((issue) => status === undefined || issue.status === status)
		.sort((a, b) => (a.order < b.order ? -1 : 1))
		.map((issue) => issue.title);
}

/** Counts the document's updates, so a test can assert that a call wrote nothing at all. */
function countWrites(doc: Y.Doc): () => number {
	let writes = 0;
	doc.on('update', () => {
		writes += 1;
	});
	return () => writes;
}

describe.each(JUNK_VALUES)('$name under issues', ({ make }) => {
	function workspace() {
		const doc = createDoc();
		const map = getIssuesMap(doc);
		const kept = createIssue(map, { title: 'Kept', status: 'todo' });
		peerWrites(doc, (issues) => issues.set('junk', make()));
		return { doc, map, kept };
	}

	it('is not an issue, and stays in the document', () => {
		const { doc, map } = workspace();
		expect(titles(doc)).toEqual(['Kept']);
		expect(map.has('junk')).toBe(true);
	});

	it('does not stop new issues getting a key', () => {
		const { doc, map } = workspace();
		expect(nextOrderKey(map)).toEqual(expect.any(String));
		createIssue(map, { title: 'Next' });
		expect(titles(doc)).toEqual(['Kept', 'Next']);
	});

	it('does not stop either seeder', () => {
		const { doc, map } = workspace();
		expect(seedIssues(map, 3, { seed: 1 })).toHaveLength(3);
		expect(seedDemoIssues(map).length).toBeGreaterThan(0);
		expect(titles(doc)).toContain('Kept');
	});

	it('cannot be patched, moved or deleted, and asking writes nothing', () => {
		const { doc, map } = workspace();
		const writes = countWrites(doc);
		patchIssue(map, 'junk', { title: 'Renamed', status: 'done' });
		moveIssue(map, 'junk', 'done', ['junk']);
		deleteIssue(map, 'junk');
		expect(writes()).toBe(0);
		expect(map.has('junk')).toBe(true);
	});

	it('is skipped as a sibling, without shifting where the card lands', () => {
		const { doc, map, kept } = workspace();
		const moved = createIssue(map, { title: 'Moved', status: 'backlog' });
		const last = createIssue(map, { title: 'Last', status: 'todo' });
		// The junk id sits ahead of the moved card, so a position counted over the raw list is
		// one too far along and the card ends up behind Last.
		moveIssue(map, moved, 'todo', ['junk', kept, moved, last]);
		expect(titles(doc, 'todo')).toEqual(['Kept', 'Moved', 'Last']);
	});

	it('is left alone when the siblings around it need repairing', () => {
		const { doc, map, kept } = workspace();
		const twin = createIssue(map, { title: 'Twin', status: 'todo' });
		const moved = createIssue(map, { title: 'Moved', status: 'backlog' });
		// Keys minted concurrently on two replicas, which is what a repair is for.
		peerWrites(doc, (issues) => {
			for (const id of [kept, twin]) (issues.get(id) as Y.Map<unknown>).set('order', 'a0');
		});
		moveIssue(map, moved, 'todo', [kept, 'junk', moved, twin]);
		expect(titles(doc, 'todo')).toEqual(['Kept', 'Moved', 'Twin']);
		expect(map.has('junk')).toBe(true);
	});
});

describe('an issue replaced by junk', () => {
	it('stops being an issue for every reader', () => {
		const doc = createDoc();
		const map = getIssuesMap(doc);
		const id = createIssue(map, { title: 'Replaced' });
		peerWrites(doc, (issues) => issues.set(id, 'boom'));

		expect(readAllIssues(map)).toEqual([]);
		patchIssue(map, id, { title: 'Too late' });
		expect(map.get(id)).toBe('boom');
	});
});
