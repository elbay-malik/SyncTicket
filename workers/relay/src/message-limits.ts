// What a room accepts from an open socket, decided before y-partyserver sees a frame.
//
// Pure and dependency-free on purpose, like `rooms.ts` and `limits.ts`: the worker entry
// imports `cloudflare:`-scheme modules a Node test runner cannot load.
//
// y-partyserver applies whatever a connection sends: a document update of any size, a request
// for the whole document as often as it is asked, presence states of any shape under any
// client id, and strings it logs in full. Every one of those is open to anyone holding a
// workspace link, and in a demo with no accounts that is anyone at all. So each frame passes
// through here first, and only what a well-behaved client sends gets through.
//
// The wire format is lib0's, as y-protocols writes it: a varUint message type, then for sync a
// varUint step and a varUint8Array, and for awareness a varUint8Array holding a varUint count
// and, per entry, a varUint client id, a varUint clock and a varString of JSON. It is decoded
// by hand here because lib0 and y-protocols are not dependencies of this worker.

import { SNAPSHOT_MAX_BYTES } from './storage.js';

/** y-protocols' message types, as y-partyserver numbers them. */
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
/** Sync step 1: "here is my state vector, send me what I lack". Answered with a full diff. */
export const SYNC_STEP_1 = 0;

/**
 * The largest frame of any kind. Twice what a room will store, because a client re-seeding a
 * room from IndexedDB sends its whole document in one frame, and a room close to the storage
 * cap must still be able to receive one.
 */
export const MAX_FRAME_BYTES = 2 * SNAPSHOT_MAX_BYTES;
/** The largest presence frame. A real one is one state of well under 200 bytes. */
export const MAX_AWARENESS_FRAME_BYTES = 8 * 1024;
/**
 * The largest one presence state, as JSON. The app's state is a flat object of a user id, a
 * display name, a colour, an issue id and two small values (`src/lib/state/presence.svelte.ts`).
 * Capped by size before it is ever parsed, which is what keeps a deeply nested state from
 * reaching `JSON.stringify` when the next visitor joins.
 */
export const MAX_AWARENESS_STATE_BYTES = 1024;
/**
 * How often one connection may ask for the whole document. A client asks once, when its socket
 * opens; without a limit, a few bytes from anyone with the link cost the room a full encode of
 * the document and send it back, as often as they like.
 */
export const SYNC_STEP_1_INTERVAL_MS = 10_000;
/**
 * Frames per second one connection may sustain, and the burst it may spend at once. Typing,
 * presence heartbeats and a drag on the board sit far below this. A connection that goes over it
 * is closed rather than silently dropped: a dropped document update would leave that client out
 * of step until it reconnected, and closing makes it reconnect, which resynchronises it.
 */
export const FRAMES_PER_SECOND = 40;
export const FRAME_BURST = 120;

export interface AwarenessEntry {
	clientId: number;
	clock: number;
	/** The state as JSON, exactly as sent. `"null"` removes the client. */
	json: string;
}

export type Frame =
	| { kind: 'sync'; step: number }
	| { kind: 'awareness'; entries: AwarenessEntry[] }
	| { kind: 'other' };

class Reader {
	#pos = 0;
	constructor(readonly bytes: Uint8Array) {}

	get done(): boolean {
		return this.#pos >= this.bytes.length;
	}

	varUint(): number {
		let value = 0;
		let multiplier = 1;
		for (let i = 0; i < 8; i++) {
			if (this.#pos >= this.bytes.length) throw new RangeError('truncated');
			const byte = this.bytes[this.#pos++]!;
			value += (byte & 0x7f) * multiplier;
			if (byte < 0x80) return value;
			multiplier *= 128;
		}
		throw new RangeError('varUint too long');
	}

	bytesOf(length: number): Uint8Array {
		if (length > this.bytes.length - this.#pos) throw new RangeError('truncated');
		const out = this.bytes.subarray(this.#pos, this.#pos + length);
		this.#pos += length;
		return out;
	}

	varUint8Array(): Uint8Array {
		return this.bytesOf(this.varUint());
	}
}

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
const encoder = new TextEncoder();

/**
 * What kind of frame `bytes` is, with a presence frame's entries decoded. Null when it is not a
 * well-formed frame at all. Only the parts this module decides on are decoded: a sync frame's
 * payload is left to Yjs, which has its own limits.
 */
export function readFrame(bytes: Uint8Array): Frame | null {
	try {
		const reader = new Reader(bytes);
		const type = reader.varUint();
		if (type === MESSAGE_SYNC) return { kind: 'sync', step: reader.varUint() };
		if (type !== MESSAGE_AWARENESS) return { kind: 'other' };
		const inner = new Reader(reader.varUint8Array());
		const count = inner.varUint();
		// Each entry takes at least three bytes, so a count the frame cannot hold is a lie.
		if (count * 3 > inner.bytes.length) return null;
		const entries: AwarenessEntry[] = [];
		for (let i = 0; i < count; i++) {
			const clientId = inner.varUint();
			const clock = inner.varUint();
			const json = decoder.decode(inner.varUint8Array());
			entries.push({ clientId, clock, json });
		}
		return { kind: 'awareness', entries };
	} catch {
		return null;
	}
}

class Writer {
	#parts: number[] = [];

	varUint(value: number): this {
		let rest = value;
		while (rest > 0x7f) {
			this.#parts.push((rest % 128) | 0x80);
			rest = Math.floor(rest / 128);
		}
		this.#parts.push(rest);
		return this;
	}

	varUint8Array(bytes: Uint8Array): this {
		this.varUint(bytes.length);
		for (const byte of bytes) this.#parts.push(byte);
		return this;
	}

	bytes(): Uint8Array {
		return Uint8Array.from(this.#parts);
	}
}

/** A presence frame holding exactly `entries`. */
export function encodeAwarenessFrame(entries: readonly AwarenessEntry[]): Uint8Array {
	const inner = new Writer().varUint(entries.length);
	for (const entry of entries) {
		inner.varUint(entry.clientId).varUint(entry.clock).varUint8Array(encoder.encode(entry.json));
	}
	return new Writer().varUint(MESSAGE_AWARENESS).varUint8Array(inner.bytes()).bytes();
}

/** Sync step 1 for a document with state vector `stateVector`, as a room sends on connect. */
export function encodeSyncStep1(stateVector: Uint8Array): Uint8Array {
	return new Writer().varUint(MESSAGE_SYNC).varUint(SYNC_STEP_1).varUint8Array(stateVector).bytes();
}

/**
 * Whether a presence state is one a real client sends: a removal, or a small flat object whose
 * values are strings, numbers, booleans or null. Anything else (an array, nesting, a huge name)
 * is not this app's presence, and passing it on puts it in front of every visitor.
 */
export function isAcceptableState(json: string): boolean {
	if (json === 'null') return true;
	if (encoder.encode(json).length > MAX_AWARENESS_STATE_BYTES) return false;
	let state: unknown;
	try {
		state = JSON.parse(json);
	} catch {
		return false;
	}
	if (typeof state !== 'object' || state === null || Array.isArray(state)) return false;
	return Object.values(state).every(
		(value) =>
			value === null ||
			typeof value === 'string' ||
			typeof value === 'boolean' ||
			(typeof value === 'number' && Number.isFinite(value))
	);
}

/** What `claimEntries` decided for one presence frame. */
export interface Claim {
	/** The entries to pass on. Empty means drop the frame. */
	keep: AwarenessEntry[];
	/** A client id this connection takes, when it held none. */
	claimed: number | null;
}

/**
 * Which entries of a presence frame a connection may set.
 *
 * A connection speaks for one client: its own tab. y-partyserver's provider sends that client's
 * state first when its socket opens, and later also sends back every other client's state it
 * hears about, which the room has already relayed and does not need again. So a connection that
 * holds no client yet takes the first entry's id, and from then on only entries for the ids it
 * holds get through. Without this, anyone with the link could set or clear anyone else's
 * presence, and the echoes cost every room a frame per peer per heartbeat.
 *
 * Taking an id another connection holds is allowed, and the caller moves it: that is a tab whose
 * old socket has not been noticed as dead yet, reconnecting. It means a connection that knows a
 * client id can take its presence, which it could always do; ids are public to the room.
 */
export function claimEntries(entries: readonly AwarenessEntry[], held: readonly number[]): Claim {
	const acceptable = entries.filter((entry) => isAcceptableState(entry.json));
	if (held.length > 0) {
		return { keep: acceptable.filter((entry) => held.includes(entry.clientId)), claimed: null };
	}
	const first = acceptable[0];
	if (!first) return { keep: [], claimed: null };
	return {
		keep: acceptable.filter((entry) => entry.clientId === first.clientId),
		claimed: first.clientId
	};
}

/**
 * A token bucket: `burst` frames at once, refilled at `perSecond`.
 *
 * Kept in memory, not in the connection's attachment. Hibernation evicts it, but a room only
 * hibernates once its sockets have gone quiet, and that quiet is already a pause the sender had
 * to take, so a bucket that starts full again after it costs nothing. Writing it to the
 * attachment on every frame would cost a serialisation per frame and eat into the attachment's
 * small size limit, which also holds y-partyserver's own state.
 */
export class FrameBudget {
	#tokens: number;
	#at: number;

	constructor(
		now: number,
		readonly perSecond = FRAMES_PER_SECOND,
		readonly burst = FRAME_BURST
	) {
		this.#tokens = burst;
		this.#at = now;
	}

	/** Spends one frame, or returns false when there is none to spend. */
	take(now: number): boolean {
		const elapsed = Math.max(0, now - this.#at) / 1000;
		this.#tokens = Math.min(this.burst, this.#tokens + elapsed * this.perSecond);
		this.#at = now;
		if (this.#tokens < 1) return false;
		this.#tokens -= 1;
		return true;
	}
}

/** What a room does with one frame. */
export type Verdict =
	| { action: 'pass'; frame: Uint8Array; claimed?: number | null }
	| { action: 'drop' }
	| { action: 'close'; code: number; reason: string };

/** Per-connection state the decision needs, owned by the room and kept in memory. */
export interface ConnectionLimits {
	budget: FrameBudget;
	/** When this connection last asked for the whole document, or null if it never has. */
	lastStep1At: number | null;
}

export function newConnectionLimits(now: number): ConnectionLimits {
	return { budget: new FrameBudget(now), lastStep1At: null };
}

/**
 * The whole decision for one frame from one connection.
 *
 * `held` is the presence ids the connection holds. When a presence frame claims a new one, the
 * returned `claimed` names it, so the room can take it away from whichever connection had it.
 */
export function admitFrame(
	message: ArrayBuffer | ArrayBufferView | string,
	limits: ConnectionLimits,
	held: readonly number[],
	now: number
): Verdict {
	// The client never sends strings. y-partyserver logs every one it gets, in full.
	if (typeof message === 'string') return { action: 'drop' };
	const bytes =
		message instanceof ArrayBuffer
			? new Uint8Array(message)
			: new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
	if (bytes.length > MAX_FRAME_BYTES) {
		return { action: 'close', code: 1009, reason: 'frame too large' };
	}
	if (!limits.budget.take(now)) {
		return { action: 'close', code: 1008, reason: 'too many messages' };
	}
	const frame = readFrame(bytes);
	if (frame === null || frame.kind === 'other') return { action: 'drop' };
	if (frame.kind === 'sync') {
		if (frame.step !== SYNC_STEP_1) return { action: 'pass', frame: bytes };
		if (limits.lastStep1At !== null && now - limits.lastStep1At < SYNC_STEP_1_INTERVAL_MS) {
			return { action: 'drop' };
		}
		limits.lastStep1At = now;
		return { action: 'pass', frame: bytes };
	}
	if (bytes.length > MAX_AWARENESS_FRAME_BYTES) return { action: 'drop' };
	const { keep, claimed } = claimEntries(frame.entries, held);
	if (keep.length === 0) return { action: 'drop' };
	const unchanged = keep.length === frame.entries.length;
	return { action: 'pass', frame: unchanged ? bytes : encodeAwarenessFrame(keep), claimed };
}
