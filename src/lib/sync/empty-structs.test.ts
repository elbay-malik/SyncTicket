// A struct can claim to take up no clock at all. Stock Yjs integrates one without complaint, and it
// then breaks in one of two ways, both on every replica it reaches. An empty GC makes the replica's
// own encoder write a delete-set entry of length zero, which the next reader chokes on after its
// structs have landed, so the relay wakes with nothing, a browser's compacted row never loads, and
// anyone holding the poison sends it back. Any empty struct after a normal one sends the search
// through that client's structs to a NaN index, on every encode from then on. The poison has to be
// stopped at the decoder, because a replica that holds it has already gone wrong, and it has to be
// dropped rather than refused, because old rows and snapshots already hold it. These go through
// bytes written by hand, because Yjs's own API cannot produce them.

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
	EMPTY_STRUCTS,
	HAND_CLIENT,
	REAL_ID,
	SLOT_ID,
	deleteSetOf,
	handWrittenStructs,
	peerWrites,
	plainStruct,
	poisonedSnapshot,
	wellFormedIssue
} from './junk-entries.fixture.js';
import { createDoc, getIssuesMap } from './doc.js';
import { readAllIssues } from './issues.js';

/** One client, one struct, client 7777, clock 0, a GC of length 0, an empty delete set. */
const EIGHT_BYTES = Uint8Array.from([0x01, 0x01, 0xe1, 0x3c, 0x00, 0x00, 0x00, 0x00]);

const FIRST_KEY = '00000000-0000-4000-8000-0000000000f1';
const SECOND_KEY = '00000000-0000-4000-8000-0000000000f2';

const titles = (doc: Y.Doc) => readAllIssues(getIssuesMap(doc)).map((issue) => issue.title);

/** A room that already holds an issue, as a relay or a tab would. */
function replicaWithAnIssue(): Y.Doc {
	const doc = createDoc();
	peerWrites(doc, (issues) => issues.set(REAL_ID, wellFormedIssue({ title: 'Kept' })));
	return doc;
}

/**
 * Everything the audit saw go wrong, asked of a replica that has been fed the update: its sync step
 * 2 reaches someone new and someone returning, each of whom can go on, and it still takes writes.
 */
function expectStillWorking(doc: Y.Doc, returning: Y.Doc): void {
	const fresh = createDoc();
	expect(() => Y.applyUpdate(fresh, Y.encodeStateAsUpdate(doc))).not.toThrow();
	expect(titles(fresh)).toEqual(titles(doc));
	expect(() => Y.encodeStateAsUpdate(fresh)).not.toThrow();

	const stepTwo = Y.encodeStateAsUpdate(doc, Y.encodeStateVector(returning));
	expect(() => Y.applyUpdate(returning, stepTwo)).not.toThrow();
	expect(titles(returning)).toEqual(titles(doc));

	const heard = vi.fn();
	doc.on('update', heard);
	peerWrites(doc, (issues) => issues.set(SLOT_ID, wellFormedIssue({ title: 'After' })));
	expect(heard).toHaveBeenCalledTimes(1);
	expect(titles(doc)).toContain('After');
}

describe('the eight-byte update', () => {
	it('changes nothing, so a relay has nothing to pass on', () => {
		const relay = replicaWithAnIssue();
		const returning = createDoc();
		Y.applyUpdate(returning, Y.encodeStateAsUpdate(relay));
		const broadcast = vi.fn();
		relay.on('update', broadcast);

		expect(() => Y.applyUpdate(relay, EIGHT_BYTES)).not.toThrow();

		expect(broadcast).not.toHaveBeenCalled();
		expect(Y.encodeStateVector(relay)).toEqual(Y.encodeStateVector(returning));
		expectStillWorking(relay, returning);
	});

	it('does no harm to a replica that passes it on regardless', () => {
		// A tab still on an older build can rebroadcast it, so it keeps arriving for a while.
		const relay = replicaWithAnIssue();
		Y.applyUpdate(relay, EIGHT_BYTES);
		Y.applyUpdate(relay, EIGHT_BYTES);
		expect(titles(relay)).toEqual(['Kept']);
		expectStillWorking(relay, createDoc());
	});
});

describe.each(EMPTY_STRUCTS)('$name', ({ bytes }) => {
	it.each([
		{
			position: 'alone',
			structs: [bytes],
			kept: {}
		},
		{
			position: 'after a normal struct',
			structs: [plainStruct(FIRST_KEY, 'first'), bytes],
			kept: { [FIRST_KEY]: 'first' }
		},
		{
			position: 'before a normal struct',
			structs: [bytes, plainStruct(FIRST_KEY, 'first')],
			kept: { [FIRST_KEY]: 'first' }
		},
		{
			position: 'between two normal structs',
			structs: [plainStruct(FIRST_KEY, 'first'), bytes, plainStruct(SECOND_KEY, 'second')],
			kept: { [FIRST_KEY]: 'first', [SECOND_KEY]: 'second' }
		}
	])('$position takes up no clock and breaks nothing', ({ structs, kept }) => {
		const doc = replicaWithAnIssue();

		expect(() => Y.applyUpdate(doc, handWrittenStructs(structs))).not.toThrow();

		const issues = getIssuesMap(doc);
		for (const [key, value] of Object.entries(kept)) expect(issues.get(key)).toBe(value);
		expect(Y.getState(doc.store, HAND_CLIENT)).toBe(Object.keys(kept).length);
		expect(titles(doc)).toEqual(['Kept']);
		expectStillWorking(doc, createDoc());
	});

	it('leaves the client able to write on from the same clock', () => {
		const doc = createDoc();
		Y.applyUpdate(doc, handWrittenStructs([plainStruct(FIRST_KEY, 'first'), bytes]));

		Y.applyUpdate(doc, handWrittenStructs([plainStruct(SECOND_KEY, 'second')], 1));

		expect(getIssuesMap(doc).get(SECOND_KEY)).toBe('second');
		expect(() => Y.encodeStateAsUpdate(doc)).not.toThrow();
	});

	it('waits with the rest of an update that cannot be placed yet', () => {
		const doc = createDoc();

		expect(() =>
			Y.applyUpdate(doc, handWrittenStructs([plainStruct(FIRST_KEY, 'first'), bytes], 5))
		).not.toThrow();

		const pending = Y.encodeStateAsUpdate(doc);
		const fresh = createDoc();
		expect(() => Y.applyUpdate(fresh, pending)).not.toThrow();
		expect(() => Y.encodeStateAsUpdate(fresh)).not.toThrow();
	});
});

describe('a delete-set entry of length zero', () => {
	const NO_STRUCTS = Uint8Array.from([0]);
	const concat = (a: Uint8Array, b: Uint8Array) => Uint8Array.from([...a, ...b]);

	it('from a client nothing is known of is not kept to retry', () => {
		const doc = replicaWithAnIssue();

		expect(() =>
			Y.applyUpdate(doc, concat(NO_STRUCTS, deleteSetOf(HAND_CLIENT, [[0, 0]])))
		).not.toThrow();

		expect(doc.store.pendingDs).toBeNull();
		expectStillWorking(doc, createDoc());
	});

	it('inside what a client wrote deletes nothing, and the range beside it still applies', () => {
		const doc = createDoc();
		Y.applyUpdate(
			doc,
			handWrittenStructs([plainStruct(FIRST_KEY, 'first'), plainStruct(SECOND_KEY, 'second')])
		);

		Y.applyUpdate(
			doc,
			concat(
				NO_STRUCTS,
				deleteSetOf(HAND_CLIENT, [
					[0, 0],
					[1, 1],
					[5, 0]
				])
			)
		);

		expect(getIssuesMap(doc).get(FIRST_KEY)).toBe('first');
		expect(getIssuesMap(doc).has(SECOND_KEY)).toBe(false);
		expect(doc.store.pendingDs).toBeNull();
		expect(() => Y.encodeStateAsUpdate(doc)).not.toThrow();
	});

	it('lets the structs that came with it stand', () => {
		const doc = createDoc();
		const update = handWrittenStructs([plainStruct(FIRST_KEY, 'first')]);

		expect(() =>
			Y.applyUpdate(doc, concat(update.slice(0, -1), deleteSetOf(HAND_CLIENT, [[7, 0]])))
		).not.toThrow();
		expect(getIssuesMap(doc).get(FIRST_KEY)).toBe('first');
	});
});

describe('what was saved before this was fixed', () => {
	it('loads whole, and comes back out clean', () => {
		const original = replicaWithAnIssue();
		const snapshot = poisonedSnapshot(Y.encodeStateAsUpdate(original));

		const loaded = createDoc();
		expect(() => Y.applyUpdate(loaded, snapshot)).not.toThrow();

		expect(titles(loaded)).toEqual(['Kept']);
		expect(Y.encodeStateVector(loaded)).toEqual(Y.encodeStateVector(original));
		expectStillWorking(loaded, createDoc());
	});
});
