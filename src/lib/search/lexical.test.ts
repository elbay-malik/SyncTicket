import { describe, expect, it } from 'vitest';
import { LexicalIndex } from './lexical.js';
import { toSearchDoc } from './protocol.js';

const doc = (id: string, title: string, description = '') =>
	toSearchDoc({ id, title, description });

function indexed(...docs: ReturnType<typeof doc>[]) {
	const index = new LexicalIndex();
	index.add(docs);
	return index;
}

describe('LexicalIndex', () => {
	it('matches on the title and on the description', () => {
		const index = indexed(
			doc('a', 'Palette keeps stale highlight'),
			doc('b', 'Board column', 'the drag handle is unreachable')
		);
		expect(index.query('palette', 10)).toEqual(['a']);
		expect(index.query('unreachable', 10)).toEqual(['b']);
	});

	it('matches a multi-word query whose words span title and description', () => {
		// The reason title and description are indexed as one combined field: FlexSearch needs
		// every term of a query to appear in the same field, so indexing them separately makes
		// this return nothing — a regression against the plain substring filter it replaces.
		const index = indexed(doc('a', 'Palette keeps stale highlight', 'focus is stranded'));
		expect(index.query('palette focus', 10)).toEqual(['a']);
	});

	it('matches prefixes, so results appear while typing', () => {
		const index = indexed(doc('a', 'Notifications are duplicated'));
		expect(index.query('notif', 10)).toEqual(['a']);
		expect(index.query('n', 10)).toEqual(['a']);
	});

	it('ranks a title match above a description-only match', () => {
		const index = indexed(
			doc('body', 'Something else', 'the sync indicator lies'),
			doc('titled', 'Sync indicator lies')
		);
		expect(index.query('sync', 10)[0]).toBe('titled');
	});

	it('honours the limit across fields rather than per field', () => {
		// FlexSearch applies `limit` to each indexed field, so a naive pass-through returns up
		// to twice what was asked for.
		const index = new LexicalIndex();
		index.add(Array.from({ length: 50 }, (_, i) => doc(`i${i}`, `Sync issue ${i}`, 'sync sync')));
		expect(index.query('sync', 10)).toHaveLength(10);
		expect(new Set(index.query('sync', 10)).size).toBe(10);
	});

	it('returns nothing for an empty query or a zero limit', () => {
		const index = indexed(doc('a', 'Anything'));
		expect(index.query('', 10)).toEqual([]);
		expect(index.query('   ', 10)).toEqual([]);
		expect(index.query('anything', 0)).toEqual([]);
	});

	it('reflects an edit through upsert instead of keeping the old text', () => {
		const index = indexed(doc('a', 'Original title'));
		expect(index.query('original', 10)).toEqual(['a']);

		index.upsert([doc('a', 'Replaced title')]);
		expect(index.query('replaced', 10)).toEqual(['a']);
		expect(index.query('original', 10)).toEqual([]);
	});

	it('upserts an id it has never seen', () => {
		const index = new LexicalIndex();
		index.upsert([doc('fresh', 'Brand new')]);
		expect(index.query('brand', 10)).toEqual(['fresh']);
	});

	it('forgets removed documents, and tolerates removing twice', () => {
		const index = indexed(doc('a', 'Temporary'), doc('b', 'Permanent'));
		index.remove(['a']);
		expect(index.query('temporary', 10)).toEqual([]);
		expect(() => index.remove(['a', 'never-existed'])).not.toThrow();
		expect(index.query('permanent', 10)).toEqual(['b']);
	});

	it('stays fast on the query a user types first', () => {
		// A single letter matches nearly everything; this is the worst case for a type-ahead
		// and the reason this engine was chosen over one that scores every match.
		const index = new LexicalIndex();
		index.add(
			Array.from({ length: 10_000 }, (_, i) =>
				doc(`i${i}`, `Sync issue number ${i}`, 'steps to reproduce')
			)
		);
		const started = performance.now();
		for (let i = 0; i < 50; i += 1) index.query('s', 20);
		expect((performance.now() - started) / 50).toBeLessThan(5);
	});
});
