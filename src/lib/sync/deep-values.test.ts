// A plain value can nest too, and it does not need a type to do it. Yjs parses a value when it
// decodes an update and writes it out again whenever it encodes one, both recursively. So a value
// that fits one of those and not the other got through the first and overflowed in the second,
// inside the cleanup that follows every transaction: the throw left that document's queue of
// transactions unfinished, no observer or `update` ever fired again, and the visitor went on typing
// into a document that kept nothing. The relay decoded it as well, so everyone arriving got it.
// patches/yjs@*.patch makes the decoders turn such a value into null. These go through bytes
// written by hand, because `Y.Map.set` only makes ContentAny, and a sender's encoder recurses too,
// so it overflows long before the deepest of these and nothing leaves.

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
	REAL_ID,
	SLOT_ID,
	VALUE_CONTENT,
	handWrittenItem,
	nestedAny,
	nestedJson,
	peerWrites
} from './junk-entries.fixture.js';
import { createDoc, getIssuesMap } from './doc.js';
import { createIssue, patchIssue, readAllIssues, readIssue } from './issues.js';

/** Either side of the stack limit in Node and Chromium, and a long way past it. */
const DEPTHS = [5_120, 20_000, 200_000];

/** What the patch allows; see MAX_VALUE_DEPTH there. */
const ALLOWED = 256;

const STRINGIFY_RECURSES = '{"toJSON":1}';

const HOSTILE = [
	{
		name: 'ContentJSON that only JSON.stringify chokes on',
		make: (depth: number) => VALUE_CONTENT.json(nestedJson(depth, STRINGIFY_RECURSES))
	},
	{
		name: 'ContentJSON of plain arrays',
		make: (depth: number) => VALUE_CONTENT.json(nestedJson(depth))
	},
	{
		name: 'ContentEmbed',
		make: (depth: number) => VALUE_CONTENT.embed(nestedJson(depth, STRINGIFY_RECURSES))
	},
	{
		name: 'ContentFormat',
		make: (depth: number) => VALUE_CONTENT.format(nestedJson(depth, STRINGIFY_RECURSES))
	},
	{ name: 'ContentAny of arrays', make: (depth: number) => VALUE_CONTENT.any(nestedAny(depth)) },
	{
		name: 'ContentAny of objects',
		make: (depth: number) => VALUE_CONTENT.any(nestedAny(depth, 'object'))
	},
	{ name: 'ContentDoc options', make: (depth: number) => VALUE_CONTENT.doc(nestedAny(depth)) }
];

const titles = (doc: Y.Doc) =>
	readAllIssues(getIssuesMap(doc))
		.map((issue) => issue.title)
		.sort();

describe.each(DEPTHS)('a value nested %i levels deep', (depth) => {
	describe.each(HOSTILE)('in $name', ({ make }) => {
		it('applies, leaves the document working, and can be sent on', () => {
			const doc = createDoc();
			const map = getIssuesMap(doc);
			createIssue(map, { title: 'Kept' });
			const heard = vi.fn();
			map.observeDeep(heard);
			const sent: Uint8Array[] = [];
			doc.on('update', (update: Uint8Array) => sent.push(update));

			expect(() => Y.applyUpdate(doc, handWrittenItem(make(depth), SLOT_ID))).not.toThrow();

			// A later write is what the frozen document silently dropped.
			heard.mockClear();
			sent.length = 0;
			createIssue(map, { title: 'After' });
			expect(heard).toHaveBeenCalledTimes(1);
			expect(sent).toHaveLength(1);

			expect(titles(doc)).toEqual(['After', 'Kept']);
			const replica = createDoc();
			expect(() => Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc))).not.toThrow();
			expect(titles(replica)).toEqual(['After', 'Kept']);
		});

		it('survives waiting for a parent that has not arrived', () => {
			const doc = createDoc();
			const missing = { client: 99, clock: 5 };

			// Yjs keeps an update it cannot place yet by encoding what it has, so this is the
			// encoder again, on a path no observer is involved in.
			expect(() =>
				Y.applyUpdate(doc, handWrittenItem(make(depth), 'field', missing))
			).not.toThrow();
			expect(() => Y.encodeStateAsUpdate(doc)).not.toThrow();
		});
	});

	it('reads as nothing when it is in a field of a real issue', () => {
		const doc = createDoc();
		peerWrites(doc, (issues) => {
			// With no neighbours to name, the hand-written item only wins a key nobody has written.
			const fresh = new Y.Map<unknown>();
			issues.set(REAL_ID, fresh);
			fresh.set('title', 'Innocent');
		});
		const yIssue = getIssuesMap(doc).get(REAL_ID) as Y.Map<unknown>;
		const parentId = (yIssue._item as Y.Item).id;

		Y.applyUpdate(
			doc,
			handWrittenItem(VALUE_CONTENT.json(nestedJson(depth, STRINGIFY_RECURSES)), 'labels', parentId)
		);

		expect(yIssue.get('labels')).toBeNull();
		expect(readIssue(REAL_ID, yIssue).labels).toEqual([]);
		patchIssue(getIssuesMap(doc), REAL_ID, { title: 'Renamed' });
		expect(titles(doc)).toEqual(['Renamed']);
	});
});

describe('what the limit must not change', () => {
	const arrayNest = (depth: number): unknown => {
		let value: unknown = 'core';
		for (let level = 0; level < depth; level += 1) value = [value];
		return value;
	};

	/** Delivers a value in both update formats, as `Y.Map.set` on another replica writes it. */
	const delivered = (value: unknown) => {
		const peer = new Y.Doc();
		getIssuesMap(peer).set(SLOT_ID, value);
		const v1 = new Y.Doc();
		const v2 = new Y.Doc();
		Y.applyUpdate(v1, Y.encodeStateAsUpdate(peer));
		Y.applyUpdateV2(v2, Y.encodeStateAsUpdateV2(peer));
		return [getIssuesMap(v1).get(SLOT_ID), getIssuesMap(v2).get(SLOT_ID)];
	};

	it('keeps a value at the limit and drops one just past it, in both formats', () => {
		expect(delivered(arrayNest(ALLOWED))).toEqual([arrayNest(ALLOWED), arrayNest(ALLOWED)]);
		expect(delivered(arrayNest(ALLOWED + 1))).toEqual([null, null]);
	});

	it('applies the same limit to JSON text, not counting brackets inside its strings', () => {
		const read = (text: string) => {
			const doc = createDoc();
			Y.applyUpdate(doc, handWrittenItem(VALUE_CONTENT.json(text), SLOT_ID));
			return getIssuesMap(doc).get(SLOT_ID);
		};

		expect(read(nestedJson(ALLOWED, '"core"'))).toEqual(arrayNest(ALLOWED));
		expect(read(nestedJson(ALLOWED + 1, '"core"'))).toBeNull();
		const wide = JSON.stringify(['['.repeat(1_000), '"\\"['.repeat(1_000), { a: [1, 2] }, [[]]]);
		expect(read(wide)).toEqual(JSON.parse(wide));
	});

	it('reads malformed JSON as nothing past the limit, and only refuses it within the limit', () => {
		const read = (text: string) => {
			const doc = createDoc();
			Y.applyUpdate(doc, handWrittenItem(VALUE_CONTENT.json(text), SLOT_ID));
			return getIssuesMap(doc).get(SLOT_ID);
		};

		expect(() => read('['.repeat(ALLOWED))).toThrow(SyntaxError);
		expect(read('['.repeat(ALLOWED + 1))).toBeNull();
	});

	it('only changes what a decoder reads, so the writer has its own value until it reloads', () => {
		const writer = createDoc();
		const value = arrayNest(ALLOWED + 44);
		getIssuesMap(writer).set(SLOT_ID, value);
		expect(getIssuesMap(writer).get(SLOT_ID)).toBe(value);

		// Nothing was taken off it on the way out, at about two bytes a level.
		const update = Y.encodeStateAsUpdate(writer);
		expect(update.length).toBeGreaterThan(2 * (ALLOWED + 44));

		// Everyone who decodes it, the writer included once it has reloaded, reads the same thing.
		const reloaded = createDoc();
		Y.applyUpdate(reloaded, update);
		expect(getIssuesMap(reloaded).get(SLOT_ID)).toBeNull();
	});

	it('passes every ordinary value through untouched, in both formats', () => {
		const everything = {
			text: 'héllo [{ "',
			number: 1.5,
			big: 2 ** 40,
			negative: -3,
			yes: true,
			no: false,
			nothing: null,
			labels: ['bug', 'p1'],
			nested: { a: [{ b: [] }] }
		};
		expect(delivered(everything)).toEqual([everything, everything]);
		expect(delivered('plain')).toEqual(['plain', 'plain']);
		expect(delivered(new Uint8Array([1, 2, 3]))).toEqual([
			new Uint8Array([1, 2, 3]),
			new Uint8Array([1, 2, 3])
		]);
		expect(delivered(10n ** 12n)).toEqual([10n ** 12n, 10n ** 12n]);
	});

	it('takes a sub-document whose options were dropped, and keeps its guid', () => {
		const doc = createDoc();

		Y.applyUpdate(doc, handWrittenItem(VALUE_CONTENT.doc(nestedAny(ALLOWED + 1)), SLOT_ID));

		expect((getIssuesMap(doc).get(SLOT_ID) as Y.Doc).guid).toBe('sub');
	});

	it('still refuses a value that is not well formed, the same on every replica', () => {
		const doc = createDoc();

		expect(() =>
			Y.applyUpdate(doc, handWrittenItem(VALUE_CONTENT.json('{nope'), SLOT_ID))
		).toThrow();
		expect(() =>
			Y.applyUpdate(doc, handWrittenItem(VALUE_CONTENT.any(Uint8Array.from([3])), SLOT_ID))
		).toThrow();
		expect(titles(doc)).toEqual([]);
	});
});

describe('a listener that throws during cleanup', () => {
	it('does not stop the document cleaning up after later transactions', () => {
		const doc = createDoc();
		const map = getIssuesMap(doc);
		const boom = () => {
			throw new RangeError('Maximum call stack size exceeded');
		};
		const heard = vi.fn();
		map.observeDeep(heard);
		doc.on('update', boom);

		expect(() => createIssue(map, { title: 'First' })).toThrow(RangeError);
		doc.off('update', boom);
		const sent = vi.fn();
		doc.on('update', sent);
		heard.mockClear();

		createIssue(map, { title: 'Second' });

		expect(heard).toHaveBeenCalledTimes(1);
		expect(sent).toHaveBeenCalledTimes(1);
	});
});
