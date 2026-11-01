// Every read and write in sync/ against an otherwise perfect issue stored under a key that is not
// an id, delivered from another replica. The store's half is in state/junk-entries.svelte.test.ts
// and what the visitor sees is in components/issues/hostile-issue-id.svelte.test.ts.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createDoc, getIssuesMap, getYIssue, yIssues } from './doc.js';
import {
	createIssue,
	deleteIssue,
	moveIssue,
	nextOrderKey,
	patchIssue,
	readAllIssues
} from './issues.js';
import { BAD_IDS, peerWrites, wellFormedIssue } from './junk-entries.fixture.js';
import { seedDemoIssues, seedIssues } from './seed.js';

/** A valid key far above anything a fresh workspace mints, so its influence is unmistakable. */
const HIGH_KEY = 'b00';

function workspace(id: string, fields?: Record<string, unknown>) {
	const doc = createDoc();
	const map = getIssuesMap(doc);
	const kept = createIssue(map, { title: 'Kept', status: 'todo' });
	peerWrites(doc, (issues) => issues.set(id, wellFormedIssue(fields)));
	let writes = 0;
	doc.on('update', () => {
		writes += 1;
	});
	return { doc, map, kept, writes: () => writes };
}

describe('the delivery these tests rely on', () => {
	it('really does put the entry in the other replica', () => {
		for (const id of BAD_IDS) {
			const { map } = workspace(id);
			expect(map.get(id)).toBeInstanceOf(Y.Map);
		}
	});
});

describe.each(BAD_IDS.map((id) => ({ id })))('an issue under the key $id', ({ id }) => {
	it('is not an issue to any reader, and stays in the document', () => {
		const { map, kept } = workspace(id);
		expect(readAllIssues(map).map((issue) => issue.id)).toEqual([kept]);
		expect([...yIssues(map)].map(([key]) => key)).toEqual([kept]);
		expect(getYIssue(map, id)).toBeUndefined();
		expect(map.has(id)).toBe(true);
	});

	it('does not raise the key a new issue gets', () => {
		const { map } = workspace(id, { order: HIGH_KEY });
		expect(nextOrderKey(map) < HIGH_KEY).toBe(true);
		const created = createIssue(map, { title: 'Next' });
		expect((getYIssue(map, created)?.get('order') as string) < HIGH_KEY).toBe(true);
	});

	it('does not raise the keys either seeder mints', () => {
		const { map } = workspace(id, { order: HIGH_KEY });
		const ids = [...seedIssues(map, 3, { seed: 1 }), ...seedDemoIssues(map)];
		for (const seeded of ids) {
			expect((getYIssue(map, seeded)?.get('order') as string) < HIGH_KEY).toBe(true);
		}
	});

	it('cannot be patched, moved or deleted, and asking writes nothing', () => {
		const { map, writes } = workspace(id);
		patchIssue(map, id, { title: 'Renamed', status: 'done' });
		moveIssue(map, id, 'done', [id]);
		deleteIssue(map, id);
		expect(writes()).toBe(0);
		expect((map.get(id) as Y.Map<unknown>).get('title')).toBe('Fix login');
	});

	it('is skipped as a sibling, without shifting where the card lands', () => {
		const { doc, map, kept } = workspace(id, { order: HIGH_KEY });
		const moved = createIssue(map, { title: 'Moved', status: 'backlog' });
		const last = createIssue(map, { title: 'Last', status: 'todo' });
		moveIssue(map, moved, 'todo', [id, kept, moved, last]);
		const todo = readAllIssues(getIssuesMap(doc))
			.filter((issue) => issue.status === 'todo')
			.sort((a, b) => (a.order < b.order ? -1 : 1))
			.map((issue) => issue.title);
		expect(todo).toEqual(['Kept', 'Moved', 'Last']);
	});

	it('is not repaired along with the siblings around it', () => {
		const { doc, map, kept } = workspace(id, { order: 'a0' });
		const twin = createIssue(map, { title: 'Twin', status: 'todo' });
		const moved = createIssue(map, { title: 'Moved', status: 'backlog' });
		peerWrites(doc, (issues) => {
			for (const key of [kept, twin]) (issues.get(key) as Y.Map<unknown>).set('order', 'a0');
		});
		moveIssue(map, moved, 'todo', [kept, id, moved, twin]);
		expect((map.get(id) as Y.Map<unknown>).get('order')).toBe('a0');
	});

	it('stays ignored when a peer writes a new issue over the same key', () => {
		const { doc, map, kept } = workspace(id);
		peerWrites(doc, (issues) => issues.set(id, wellFormedIssue({ title: 'Still not one' })));
		expect(readAllIssues(map).map((issue) => issue.id)).toEqual([kept]);
	});
});
