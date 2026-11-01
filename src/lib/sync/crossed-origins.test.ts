// An item names what was to its left and its right when it was written, and takes its parent from
// them. A hand-written one can name neighbours in two different parents, which no real write can.
// Stock Yjs took the left one's parent regardless, so with the items below it won an issue's key on
// every replica holding the originals, and showed there as a live row. Winning the key deleted the
// old value and everything under it, so the right neighbour was collected, and a replica reading
// that state saw a collected neighbour and wrote the item off. Both ends had the same state vector,
// so nothing would repair it, and edits to the row never reached the replica that had no row. The
// patch writes off such an item on every replica. These go through bytes written by hand.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { REAL_ID, SLOT_ID, wellFormedIssue } from './junk-entries.fixture.js';
import { createDoc, getIssuesMap, getYIssue } from './doc.js';
import { patchIssue, readAllIssues } from './issues.js';

const CLIENT = 4_242;

function varUint(value: number): number[] {
	const bytes: number[] = [];
	let rest = value;
	while (rest > 127) {
		bytes.push((rest % 128) | 128);
		rest = Math.floor(rest / 128);
	}
	bytes.push(rest);
	return bytes;
}

/** An empty Y.Map with the given neighbours, written by `CLIENT` at `clock` in a v1 update. */
function crossedMap(clock: number, left: number, right: number): Uint8Array {
	const hasOrigin = 128;
	const hasRightOrigin = 64;
	const contentType = 7;
	const yMapRef = 1;
	return Uint8Array.from([
		1,
		1,
		...varUint(CLIENT),
		...varUint(clock),
		hasOrigin | hasRightOrigin | contentType,
		...varUint(CLIENT),
		...varUint(left),
		...varUint(CLIENT),
		...varUint(right),
		yMapRef,
		// An empty delete set.
		0
	]);
}

/** A peer's issue, with an array under it holding a value, and where each of those landed. */
function issueWithAnArray(): { update: Uint8Array; next: number; issue: number; inArray: number } {
	const peer = createDoc();
	peer.clientID = CLIENT;
	const yIssue = wellFormedIssue({ title: 'Original' });
	getIssuesMap(peer).set(REAL_ID, yIssue);
	const array = new Y.Array<string>();
	yIssue.set('zzz', array);
	array.push(['in the array']);
	const issue = (yIssue._item as Y.Item).id.clock;
	const inArray = (array._start as Y.Item).id.clock;
	return {
		update: Y.encodeStateAsUpdate(peer),
		next: Y.getState(peer.store, CLIENT),
		issue,
		inArray
	};
}

const titles = (doc: Y.Doc) => readAllIssues(getIssuesMap(doc)).map((issue) => issue.title);

/**
 * A relay taking the two updates apart, a tab fed what it passes on, and someone arriving later who
 * is sent the relay's state.
 */
function deliver(first: Uint8Array, second: Uint8Array) {
	const relay = createDoc();
	const live = createDoc();
	relay.on('update', (update: Uint8Array) => Y.applyUpdate(live, update));
	Y.applyUpdate(relay, first);
	Y.applyUpdate(relay, second);
	const fresh = createDoc();
	Y.applyUpdate(fresh, Y.encodeStateAsUpdate(relay));
	return { relay, live, fresh };
}

describe('an item whose neighbours sit in different parents', () => {
	it('with the left one higher up reads the same everywhere, and costs nothing', () => {
		const { update, next, issue, inArray } = issueWithAnArray();

		const { relay, live, fresh } = deliver(update, crossedMap(next, issue, inArray));

		expect(titles(relay)).toEqual(['Original']);
		expect(titles(live)).toEqual(['Original']);
		expect(titles(fresh)).toEqual(['Original']);
		expect(Y.encodeStateVector(live)).toEqual(Y.encodeStateVector(fresh));
	});

	it('with the right one higher up reads the same everywhere, and costs nothing', () => {
		const { update, next, issue, inArray } = issueWithAnArray();

		const { relay, live, fresh } = deliver(update, crossedMap(next, inArray, issue));

		expect(titles(relay)).toEqual(['Original']);
		expect(titles(live)).toEqual(['Original']);
		expect(titles(fresh)).toEqual(['Original']);
		const yIssue = getYIssue(getIssuesMap(fresh), REAL_ID) as Y.Map<unknown>;
		expect((yIssue.get('zzz') as Y.Array<unknown>).toArray()).toEqual(['in the array']);
	});

	it('leaves the row editable, with the edit reaching someone who arrived later', () => {
		const { update, next, issue, inArray } = issueWithAnArray();
		const { live, fresh } = deliver(update, crossedMap(next, issue, inArray));

		const since = Y.encodeStateVector(fresh);
		patchIssue(getIssuesMap(live), REAL_ID, { title: 'Edited' });
		Y.applyUpdate(fresh, Y.encodeStateAsUpdate(live, since));

		expect(titles(live)).toEqual(['Edited']);
		expect(titles(fresh)).toEqual(['Edited']);
	});

	it('takes its clock, so what the client writes next still lines up', () => {
		const { update, next, issue, inArray } = issueWithAnArray();
		const { fresh } = deliver(update, crossedMap(next, issue, inArray));

		expect(Y.getState(fresh.store, CLIENT)).toBe(next + 1);
	});

	it('leaves nothing that fails to encode', () => {
		const { update, next, issue, inArray } = issueWithAnArray();
		const { relay, live, fresh } = deliver(update, crossedMap(next, issue, inArray));

		for (const doc of [relay, live, fresh]) {
			const again = createDoc();
			Y.applyUpdate(again, Y.encodeStateAsUpdate(doc));
			expect(titles(again)).toEqual(['Original']);
		}
	});
});

describe('an item whose neighbours sit in the same parent', () => {
	it('under two keys of one map is written off too', () => {
		const peer = createDoc();
		peer.clientID = CLIENT;
		const issues = getIssuesMap(peer);
		const first = wellFormedIssue({ title: 'First' });
		issues.set(REAL_ID, first);
		const second = wellFormedIssue({ title: 'Second' });
		issues.set(SLOT_ID, second);
		const crossed = crossedMap(
			Y.getState(peer.store, CLIENT),
			(first._item as Y.Item).id.clock,
			(second._item as Y.Item).id.clock
		);

		const { relay, live, fresh } = deliver(Y.encodeStateAsUpdate(peer), crossed);

		const expected = ['First', 'Second'];
		expect(titles(relay).sort()).toEqual(expected);
		expect(titles(live).sort()).toEqual(expected);
		expect(titles(fresh).sort()).toEqual(expected);
	});

	it('between two items of one array is an ordinary insert', () => {
		// The shape every concurrent insert has, so the check must not catch it.
		const peer = createDoc();
		peer.clientID = CLIENT;
		const yIssue = wellFormedIssue({ title: 'Original' });
		getIssuesMap(peer).set(REAL_ID, yIssue);
		const array = new Y.Array<string>();
		yIssue.set('zzz', array);
		array.push(['left']);
		array.push(['right']);

		const other = createDoc();
		Y.applyUpdate(other, Y.encodeStateAsUpdate(peer));
		const theirIssue = getYIssue(getIssuesMap(other), REAL_ID) as Y.Map<unknown>;
		(theirIssue.get('zzz') as Y.Array<string>).insert(1, ['between']);

		const relay = createDoc();
		Y.applyUpdate(relay, Y.encodeStateAsUpdate(peer));
		Y.applyUpdate(relay, Y.encodeStateAsUpdate(other));
		const seen = getYIssue(getIssuesMap(relay), REAL_ID) as Y.Map<unknown>;

		expect((seen.get('zzz') as Y.Array<string>).toArray()).toEqual(['left', 'between', 'right']);
	});
});
