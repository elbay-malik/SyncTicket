// What a room lets through from an open socket. Frames here are built with y-protocols and lib0,
// the same libraries the client uses, so the hand-written decoder is checked against the real
// encoding rather than against itself.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import {
	FRAME_BURST,
	FrameBudget,
	MAX_AWARENESS_STATE_BYTES,
	MAX_FRAME_BYTES,
	MESSAGE_AWARENESS,
	SYNC_STEP_1_INTERVAL_MS,
	admitFrame,
	claimEntries,
	encodeAwarenessFrame,
	encodeSyncStep1,
	isAcceptableState,
	newConnectionLimits,
	readFrame
} from './message-limits.js';

const presence = { userId: 'u1', name: 'Lively Raven', hue: 210, issue: null, t: 1, alone: false };

/** A client's awareness frame as y-partyserver's provider sends it. */
function awarenessFrame(states: Array<[number, unknown]>): Uint8Array {
	const awareness = new Awareness(new Y.Doc());
	clearInterval(awareness._checkInterval);
	for (const [clientId, state] of states) {
		awareness.states.set(clientId, state as Record<string, unknown>);
		awareness.meta.set(clientId, { clock: 3, lastUpdated: 0 });
	}
	const encoder = encoding.createEncoder();
	encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
	encoding.writeVarUint8Array(
		encoder,
		encodeAwarenessUpdate(
			awareness,
			states.map(([id]) => id)
		)
	);
	return encoding.toUint8Array(encoder);
}

function syncFrame(step: 'one' | 'update', doc = new Y.Doc()): Uint8Array {
	const encoder = encoding.createEncoder();
	encoding.writeVarUint(encoder, 0);
	if (step === 'one') syncProtocol.writeSyncStep1(encoder, doc);
	else {
		doc.getMap('issues').set('x', 1);
		syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(doc));
	}
	return encoding.toUint8Array(encoder);
}

describe('readFrame', () => {
	it('reads presence frames exactly as y-protocols writes them', () => {
		const frame = readFrame(
			awarenessFrame([
				[7, presence],
				[300_000, null]
			])
		);
		expect(frame).toEqual({
			kind: 'awareness',
			entries: [
				{ clientId: 7, clock: 3, json: JSON.stringify(presence) },
				{ clientId: 300_000, clock: 3, json: 'null' }
			]
		});
	});

	it('tells sync step 1 from the other sync messages', () => {
		expect(readFrame(syncFrame('one'))).toEqual({ kind: 'sync', step: 0 });
		expect(readFrame(syncFrame('update'))).toEqual({ kind: 'sync', step: 2 });
	});

	it('refuses frames that are not well formed', () => {
		expect(readFrame(new Uint8Array([]))).toBeNull();
		expect(readFrame(new Uint8Array([1, 200]))).toBeNull();
		// A count far larger than the bytes that follow.
		expect(readFrame(new Uint8Array([1, 3, 0xff, 0xff, 0x7f]))).toBeNull();
		expect(readFrame(new Uint8Array([9]))).toEqual({ kind: 'other' });
	});
});

describe('encoding', () => {
	it('writes presence frames y-protocols can apply', () => {
		const bytes = encodeAwarenessFrame([
			{ clientId: 42, clock: 5, json: JSON.stringify(presence) }
		]);
		const decoder = decoding.createDecoder(bytes);
		expect(decoding.readVarUint(decoder)).toBe(MESSAGE_AWARENESS);
		const target = new Awareness(new Y.Doc());
		clearInterval(target._checkInterval);
		applyAwarenessUpdate(target, decoding.readVarUint8Array(decoder), 'test');
		expect(target.getStates().get(42)).toEqual(presence);
	});

	it('writes the sync step 1 a room sends on connect', () => {
		const doc = new Y.Doc();
		doc.getMap('issues').set('a', 1);
		expect(encodeSyncStep1(Y.encodeStateVector(doc))).toEqual(syncFrame('one', doc));
	});
});

describe('isAcceptableState', () => {
	it('accepts the app’s own presence state, and removal', () => {
		expect(isAcceptableState(JSON.stringify(presence))).toBe(true);
		expect(isAcceptableState('null')).toBe(true);
	});

	it('refuses nesting, arrays and anything too large to be a presence state', () => {
		// A deeply nested state is what made the next visitor's connection fail, in JSON.stringify.
		expect(isAcceptableState('['.repeat(5000) + ']'.repeat(5000))).toBe(false);
		expect(isAcceptableState(JSON.stringify({ name: { first: 'a' } }))).toBe(false);
		expect(isAcceptableState(JSON.stringify([1, 2]))).toBe(false);
		expect(isAcceptableState('"just a string"')).toBe(false);
		expect(isAcceptableState('{ not json')).toBe(false);
		expect(isAcceptableState(JSON.stringify({ name: 'x'.repeat(MAX_AWARENESS_STATE_BYTES) }))).toBe(
			false
		);
	});
});

describe('claimEntries', () => {
	const entry = (clientId: number, state: unknown = presence) => ({
		clientId,
		clock: 1,
		json: JSON.stringify(state)
	});

	it('gives a new connection the first client id it speaks for', () => {
		expect(claimEntries([entry(5), entry(9)], [], true)).toEqual({ keep: [entry(5)], claimed: 5 });
	});

	it('lets a connection set only the presence it holds', () => {
		// The provider echoes every peer's state back; those, and anyone else's, are dropped.
		expect(claimEntries([entry(9), entry(5), entry(5, null)], [5], false)).toEqual({
			keep: [entry(5), entry(5, null)],
			claimed: null
		});
		expect(claimEntries([entry(9)], [5], false)).toEqual({ keep: [], claimed: null });
	});

	it('claims only from a connection’s first presence frame, never from a later echo', () => {
		// A tab that reconnected without a reload holds nothing the room recorded; its later
		// frames echo peers' states, and claiming from one would take a peer's presence.
		expect(claimEntries([entry(9)], [], false)).toEqual({ keep: [], claimed: null });
	});

	it('never claims an id for a state it would not pass on', () => {
		expect(claimEntries([entry(5, [1]), entry(9)], [], true)).toEqual({
			keep: [entry(9)],
			claimed: 9
		});
	});
});

describe('FrameBudget', () => {
	it('allows a burst, then a steady rate', () => {
		const budget = new FrameBudget(0, 10, 5);
		for (let i = 0; i < 5; i++) expect(budget.take(0)).toBe(true);
		expect(budget.take(0)).toBe(false);
		expect(budget.take(100)).toBe(true);
		expect(budget.take(100)).toBe(false);
		expect(budget.take(10_000)).toBe(true);
	});
});

describe('admitFrame', () => {
	const now = 1_000_000;
	const fresh = { held: [] as number[], claimedBefore: false };

	it('passes the frames an ordinary client sends', () => {
		const limits = newConnectionLimits(now);
		expect(admitFrame(syncFrame('one'), limits, fresh, now).action).toBe('pass');
		expect(admitFrame(syncFrame('update'), limits, fresh, now).action).toBe('pass');
		const first = admitFrame(awarenessFrame([[5, presence]]), limits, fresh, now);
		expect(first).toMatchObject({ action: 'pass', claimed: 5, presenceFrame: true });
	});

	it('marks a first presence frame even when nothing in it can be passed on', () => {
		const verdict = admitFrame(awarenessFrame([[5, [1, 2]]]), newConnectionLimits(now), fresh, now);
		expect(verdict).toEqual({ action: 'drop', presenceFrame: true });
	});

	it('drops strings, which the client never sends and the base class logs in full', () => {
		expect(admitFrame('__YPS:hello', newConnectionLimits(now), fresh, now)).toEqual({
			action: 'drop'
		});
	});

	it('closes a connection that sends more than a room would ever take in one frame', () => {
		const verdict = admitFrame(
			new Uint8Array(MAX_FRAME_BYTES + 1),
			newConnectionLimits(now),
			fresh,
			now
		);
		expect(verdict).toMatchObject({ action: 'close', code: 1009 });
	});

	it('closes a connection that sends faster than any client does', () => {
		const limits = newConnectionLimits(now);
		const frame = syncFrame('update');
		for (let i = 0; i < FRAME_BURST; i++) {
			expect(admitFrame(frame, limits, fresh, now).action).toBe('pass');
		}
		expect(admitFrame(frame, limits, fresh, now)).toMatchObject({ action: 'close', code: 1008 });
	});

	it('answers a request for the whole document once per interval', () => {
		const limits = newConnectionLimits(now);
		expect(admitFrame(syncFrame('one'), limits, fresh, now).action).toBe('pass');
		expect(admitFrame(syncFrame('one'), limits, fresh, now + 1).action).toBe('drop');
		expect(admitFrame(syncFrame('one'), limits, fresh, now + SYNC_STEP_1_INTERVAL_MS).action).toBe(
			'pass'
		);
	});

	it('re-encodes a presence frame to the entries it may set, and drops one with none', () => {
		const limits = newConnectionLimits(now);
		const verdict = admitFrame(
			awarenessFrame([
				[9, presence],
				[5, presence]
			]),
			limits,
			{ held: [5], claimedBefore: true },
			now
		);
		expect(verdict.action).toBe('pass');
		if (verdict.action !== 'pass') return;
		expect(readFrame(verdict.frame)).toEqual({
			kind: 'awareness',
			entries: [{ clientId: 5, clock: 3, json: JSON.stringify(presence) }]
		});
		expect(
			admitFrame(awarenessFrame([[9, presence]]), limits, { held: [5], claimedBefore: true }, now)
		).toEqual({
			action: 'drop',
			presenceFrame: true
		});
	});
});
