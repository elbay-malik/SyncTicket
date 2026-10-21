// Encoding a Yjs document for the room's SQLite table.
//
// Kept free of `partyserver` and `cloudflare:workers` imports so it can be unit-tested under
// plain Node: this is the part where a mistake is silent, because a corrupted snapshot only
// shows up as a room that has forgotten everything.
//
// That one-row-per-room design has a hard ceiling, which is why this module also owns the
// sizes and the health marker. Cloudflare caps a single string/BLOB — and therefore a row —
// at 2 MB; it is not plan-split, so no upgrade removes it. Past the cap the write throws,
// and y-partyserver swallows the rejection (`dist/server/index.js:185-195`), leaving a room
// that relays in memory, looks healthy, and loses everything since the last good write at
// the next hibernation eviction. The decision is to *report* the ceiling rather than raise
// it: a never-edited workspace reaches 2,000,000 bytes at roughly 6,100 issues with empty
// descriptions and ~1,300 with ~1,200-character ones (`bytes ≈ 320 + descriptionLength`
// per issue, linear), and gc is already on — `new Y.Doc()` defaults to `gc: true` — so
// deletion churn needs on the order of 90,000 field edits to get there on tombstones alone.
// Every alternative that raises the ceiling trades a loud limit for a quiet one, so what
// this module provides instead is a size classification, a durable health row, and one
// encoded notice the client can render.

import * as Y from 'yjs';

/**
 * The documented cap: Cloudflare's own footnote defines 1 GB as 1,000,000,000 bytes, so
 * 2 MB is 2,000,000 and *not* 2,097,152. Local workerd happens to accept ~2,199,994 bytes,
 * but that is a `SQLITE_MAX_LENGTH` build constant rather than a contract, and the slack is
 * deliberately not spent.
 */
export const SNAPSHOT_BUDGET_BYTES = 2_000_000;

/** Stop here: 5% under the cap, because SQLite's per-row overhead is uncharacterised. */
export const SNAPSHOT_MAX_BYTES = 1_900_000;

/** 75% of the budget — the only notice that can arrive *before* anything is lost. */
export const SNAPSHOT_WARN_BYTES = 1_500_000;

export type SnapshotSize = 'ok' | 'warn' | 'over';

/** Where an encoded snapshot sits against the two thresholds above. */
export function classifySnapshot(byteLength: number): SnapshotSize {
	if (byteLength > SNAPSHOT_MAX_BYTES) return 'over';
	if (byteLength > SNAPSHOT_WARN_BYTES) return 'warn';
	return 'ok';
}

export type PersistFailure = 'too-big' | 'unknown';

/**
 * Names a write failure for the notice channel.
 *
 * The size pre-check against {@link SNAPSHOT_MAX_BYTES} is what actually classifies the
 * oversize case; this covers only the residual one, where a write we expected to fit was
 * refused anyway. Measured in local workerd the rejection is a plain `Error` with the
 * message `string or blob too big: SQLITE_TOOBIG`, no `.code` and no own enumerable
 * properties — a message substring is the only discriminator that exists, and Cloudflare
 * documents neither the wording nor the shape.
 *
 * Total, and must never throw: this runs inside `onSave`'s catch, and a throw from here
 * would escape into y-partyserver's swallow, which is the original bug.
 */
export function classifyWriteError(err: unknown): PersistFailure {
	let message: string;
	try {
		message = String((err as { message?: unknown })?.message ?? err);
	} catch {
		return 'unknown';
	}
	return /too big|TOOBIG/i.test(message) ? 'too-big' : 'unknown';
}

/** The single row every room keeps: the whole document as one update. */
export const SNAPSHOT_TABLE = 'ydoc_snapshot';

export function createTableSql(): string {
	return `CREATE TABLE IF NOT EXISTS ${SNAPSHOT_TABLE} (id INTEGER PRIMARY KEY, doc BLOB NOT NULL)`;
}

export function writeSnapshotSql(): string {
	return `INSERT OR REPLACE INTO ${SNAPSHOT_TABLE} (id, doc) VALUES (1, ?)`;
}

export function readSnapshotSql(): string {
	return `SELECT doc FROM ${SNAPSHOT_TABLE} WHERE id = 1`;
}

/**
 * The one row recording whether persistence is working.
 *
 * It exists because the failure outlives the instance: the room hibernates, is evicted, and
 * the next visitor — who on the "discovered months later" path is *every* visitor — would
 * otherwise meet a healthy-looking UI. Like the snapshot table it is a single row with no
 * secondary index, so one statement is one row written.
 */
export const HEALTH_TABLE = 'ydoc_health';

export function createHealthTableSql(): string {
	return `CREATE TABLE IF NOT EXISTS ${HEALTH_TABLE} (id INTEGER PRIMARY KEY, state TEXT NOT NULL, bytes INTEGER NOT NULL, at INTEGER NOT NULL, reason TEXT)`;
}

export function writeHealthSql(): string {
	return `INSERT OR REPLACE INTO ${HEALTH_TABLE} (id, state, bytes, at, reason) VALUES (1, ?, ?, ?, ?)`;
}

export function readHealthSql(): string {
	return `SELECT state, bytes, at, reason FROM ${HEALTH_TABLE} WHERE id = 1`;
}

/** The whole document as a single update, ready to store. */
export function encodeSnapshot(doc: Y.Doc): Uint8Array {
	return Y.encodeStateAsUpdate(doc);
}

/**
 * Rebuilds a document from a stored snapshot.
 *
 * SQLite hands blobs back as `ArrayBuffer`, so accept either that or a view; anything else
 * means the row is missing or damaged, and an empty document is the right answer — the room
 * then re-syncs from whichever client connects, rather than refusing to start.
 */
export function decodeSnapshot(stored: unknown): Y.Doc {
	const doc = new Y.Doc();
	const bytes = toBytes(stored);
	if (bytes && bytes.byteLength > 0) {
		try {
			Y.applyUpdate(doc, bytes);
		} catch {
			return new Y.Doc();
		}
	}
	return doc;
}

function toBytes(stored: unknown): Uint8Array | null {
	if (stored instanceof Uint8Array) return stored;
	if (stored instanceof ArrayBuffer) return new Uint8Array(stored);
	if (ArrayBuffer.isView(stored)) {
		return new Uint8Array(stored.buffer, stored.byteOffset, stored.byteLength);
	}
	return null;
}

export type PersistenceState = 'ok' | 'degraded' | 'stale';

export interface PersistenceNotice {
	state: PersistenceState;
	reason?: PersistFailure;
	at: number;
}

/**
 * Encodes the persistence notice the relay pushes to clients.
 *
 * This is one half of a deliberately duplicated fact: `src/lib/sync/relay-notice.ts` in the
 * app holds the decoder, and the two workers share no code. Change one, change the other in
 * the same commit — the same standing rule as `RELAY_PARTY` and the Durable Object binding
 * name.
 *
 * Key order is fixed so the encoded frame is assertable as a literal on both sides, and
 * `reason` is present only when something is wrong. The channel carries a closed enum and
 * never display text: the UI renders its own copy keyed by `state` and `reason`, so a
 * malformed or hostile frame can at worst be ignored.
 */
export function encodePersistenceNotice(n: PersistenceNotice): string {
	return n.state === 'ok'
		? JSON.stringify({ v: 1, type: 'persistence', state: n.state, at: n.at })
		: JSON.stringify({ v: 1, type: 'persistence', state: n.state, reason: n.reason, at: n.at });
}
