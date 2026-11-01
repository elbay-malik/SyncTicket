// A sub-document carries an object of options, which is a peer's to fill in, and stock Yjs spread it
// over the arguments of `new Doc`. `{ guid: null }` therefore replaced the guid the item had just
// read. The item integrated, and then every attempt to write it threw, starting inside the cleanup
// of that transaction: a relay stopped answering and saving, and a resend was a few bytes away. These
// go through bytes written by hand, because a real sub-document only ever writes `gc`, `autoLoad` and
// `meta`, which is all the patch now reads.

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { SLOT_ID, VALUE_CONTENT, handWrittenItem, peerWrites } from './junk-entries.fixture.js';
import { createDoc, getIssuesMap } from './doc.js';
import { readAllIssues } from './issues.js';

const REAL_KEY = '00000000-0000-4000-8000-0000000000d1';

/** lib0's binary form of the bits these options are made of. */
const utf8 = (text: string) => [
	text.length,
	...[...text].map((character) => character.charCodeAt(0))
];
const NULL = [126];
const UNDEFINED = [127];
const TRUE = [120];
const FIVE = [125, 5];
const TEXT = [119, ...utf8('other')];
const AN_ARRAY = [117, 1, 125, 5];
const AN_OBJECT = [118, 1, ...utf8('a'), 125, 5];
const objectOf = (key: string, value: number[]) =>
	Uint8Array.from([118, 1, ...utf8(key), ...value]);

const OPTIONS: ReadonlyArray<{ name: string; bytes: Uint8Array }> = [
	{ name: '{ guid: null }', bytes: objectOf('guid', NULL) },
	{ name: '{ guid: undefined }', bytes: objectOf('guid', UNDEFINED) },
	{ name: '{ guid: 5 }', bytes: objectOf('guid', FIVE) },
	{ name: '{ guid: true }', bytes: objectOf('guid', TRUE) },
	{ name: "{ guid: 'other' }", bytes: objectOf('guid', TEXT) },
	{ name: '{ guid: [5] }', bytes: objectOf('guid', AN_ARRAY) },
	{ name: '{ guid: { a: 5 } }', bytes: objectOf('guid', AN_OBJECT) },
	{ name: '{ gcFilter: 5 }', bytes: objectOf('gcFilter', FIVE) },
	{ name: '{ collectionid: null }', bytes: objectOf('collectionid', NULL) },
	{ name: '{ meta: null }', bytes: objectOf('meta', NULL) },
	{ name: '{ gc: 5 }', bytes: objectOf('gc', FIVE) },
	{ name: 'null', bytes: Uint8Array.from(NULL) },
	{ name: 'undefined', bytes: Uint8Array.from(UNDEFINED) },
	{ name: 'a number', bytes: Uint8Array.from(FIVE) },
	{ name: 'a string', bytes: Uint8Array.from(TEXT) },
	{ name: 'an array', bytes: Uint8Array.from(AN_ARRAY) },
	{ name: 'binary', bytes: Uint8Array.from([116, 1, 5]) }
];

const subdocUnder = (doc: Y.Doc, key: string) => getIssuesMap(doc).get(key) as Y.Doc;

describe.each(OPTIONS)('a sub-document whose options are $name', ({ bytes }) => {
	it('keeps the guid it was sent with, on every replica', () => {
		const update = handWrittenItem(VALUE_CONTENT.doc(bytes), SLOT_ID);

		const relay = createDoc();
		const broadcast: Uint8Array[] = [];
		relay.on('update', (sent: Uint8Array) => broadcast.push(sent));
		expect(() => Y.applyUpdate(relay, update)).not.toThrow();
		expect(subdocUnder(relay, SLOT_ID).guid).toBe('sub');
		expect(subdocUnder(relay, SLOT_ID).gcFilter(undefined as never)).toBe(true);

		// Live, through what the relay passed on, and fresh, through what it would send on arrival.
		const live = createDoc();
		for (const sent of broadcast) expect(() => Y.applyUpdate(live, sent)).not.toThrow();
		expect(subdocUnder(live, SLOT_ID).guid).toBe('sub');

		const fresh = createDoc();
		expect(() => Y.applyUpdate(fresh, Y.encodeStateAsUpdate(relay))).not.toThrow();
		expect(subdocUnder(fresh, SLOT_ID).guid).toBe('sub');
		expect(() => Y.encodeStateAsUpdate(fresh)).not.toThrow();
	});

	it('leaves the document taking writes, and sending them on', () => {
		const doc = createDoc();
		Y.applyUpdate(doc, handWrittenItem(VALUE_CONTENT.doc(bytes), SLOT_ID));
		const heard = vi.fn();
		doc.on('update', heard);

		peerWrites(doc, (issues) => {
			const yIssue = new Y.Map<unknown>();
			issues.set(REAL_KEY, yIssue);
			yIssue.set('title', 'After');
		});

		expect(heard).toHaveBeenCalledTimes(1);
		expect(readAllIssues(getIssuesMap(doc)).map((issue) => issue.title)).toEqual(['After']);
	});

	it('survives being deleted and collected', () => {
		const doc = createDoc();
		Y.applyUpdate(doc, handWrittenItem(VALUE_CONTENT.doc(bytes), SLOT_ID));

		expect(() => getIssuesMap(doc).delete(SLOT_ID)).not.toThrow();

		const fresh = createDoc();
		expect(() => Y.applyUpdate(fresh, Y.encodeStateAsUpdate(doc))).not.toThrow();
		expect(getIssuesMap(fresh).has(SLOT_ID)).toBe(false);
	});
});

it('a real sub-document comes through with everything it writes', () => {
	const peer = createDoc();
	getIssuesMap(peer).set(
		REAL_KEY,
		new Y.Doc({ guid: 'real', gc: false, autoLoad: true, meta: { kept: 1 } })
	);

	const replica = createDoc();
	Y.applyUpdate(replica, Y.encodeStateAsUpdate(peer));

	const received = subdocUnder(replica, REAL_KEY);
	expect(received.guid).toBe('real');
	expect(received.gc).toBe(false);
	expect(received.autoLoad).toBe(true);
	expect(received.shouldLoad).toBe(true);
	expect(received.meta).toEqual({ kept: 1 });
});
