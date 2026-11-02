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
// encoded notice the client can render. A row can also be readable by nothing, so this module
// tells a damaged snapshot from an empty one, and keeps the damaged one (ADR 0010).

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
/**
 * How many structs a cold wake can re-apply before it is worth a log line.
 *
 * A DIFFERENT AXIS from the byte budget above, and the reason both exist. Waking a hibernated
 * room runs `Y.applyUpdate` over the whole snapshot, and that cost tracks the number of Yjs
 * structs, not the byte count — measured at 0.465-0.665 microseconds per struct across every
 * shape tried, in Node and inside real workerd. The two ceilings therefore do not imply each
 * other, and the byte guard is blind to this one in both directions:
 *
 *   3,000 issues, empty descriptions   880 KB   byte guard SILENT   ~14-18 ms wake
 *   500 issues + 20,000 churned        512 KB   byte guard SILENT   ~12 ms wake
 *   1,315 issues, long descriptions    1.96 MB  byte guard OVER     ~6-9 ms wake
 *
 * 20,000 structs is about 2,000 issues (ten structs each: the sub-map plus nine fields), which
 * is roughly where the wake passes 10 ms. Why 10 ms matters is genuinely unresolved: the
 * Durable Objects limits page gives "CPU per request | 30 seconds (default)" with no plan
 * split, while its own FAQ says Durable Objects have "the same per invocation CPU limits as any
 * Workers do" and links to a table reading "CPU time | 10 ms" for Workers Free. Neither page
 * states a free-plan Durable Object figure, and Wrangler documents that limits "are only
 * enforced when deployed to Cloudflare's network, not in local development" — so this cannot
 * be settled anywhere but a real deployed account (ADR 0010).
 *
 * Hence a LOG LINE and nothing else: no user notice, no cap, no refusal. Under the 30-second
 * reading this is noise in a log nobody reads; under the 10 ms reading it is the only warning
 * that a workspace is approaching the point where its room stops loading at all — which,
 * unlike the byte ceiling, has no graceful degradation, because a room must load to serve.
 */
export const WAKE_WARN_STRUCTS = 20_000;

/** Microseconds per struct, measured. Only ever used to put a number in a log line. */
const WAKE_US_PER_STRUCT = 0.6;

/**
 * Total structs in the document, including tombstones — what a cold wake re-applies.
 *
 * The state vector holds one clock per client and the clock is that client's struct count, so
 * summing it is both exact and cheap. Deliberately schema-free: counting issues instead would
 * make this worker the third place that knows the app's document shape, and it would miss
 * churn residue entirely, which the 512 KB row above shows is reachable on its own.
 */
export function countStructs(doc: Y.Doc): number {
	let total = 0;
	for (const clock of Y.decodeStateVector(Y.encodeStateVector(doc)).values()) total += clock;
	return total;
}

/** A rough wake cost for the log line, in whole milliseconds. Not a promise. */
export function approxWakeMs(structs: number): number {
	return Math.round((structs * WAKE_US_PER_STRUCT) / 1000);
}

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

/**
 * The health row's `reason` for a room whose bytes will not reload: a stored row that would not
 * decode, or a save refused because what it encoded would not. It stays in the row and never goes
 * on the wire, where it reads as 'unknown' (ADR 0010 says why). `planLoad` is what reads it.
 */
export const UNREADABLE_REASON = 'unreadable';

/**
 * The one row keeping a snapshot this room could not read, for someone to recover by hand.
 *
 * Only an operator ever reads it (ADR 0010 has the steps). `error` is whatever the decoder threw.
 */
export const QUARANTINE_TABLE = 'ydoc_quarantine';

export function createQuarantineTableSql(): string {
	return `CREATE TABLE IF NOT EXISTS ${QUARANTINE_TABLE} (id INTEGER PRIMARY KEY, doc BLOB NOT NULL, at INTEGER NOT NULL, error TEXT)`;
}

/** A plain INSERT and not the OR REPLACE the other tables use: it cannot overwrite a row. */
export function writeQuarantineSql(): string {
	return `INSERT INTO ${QUARANTINE_TABLE} (id, doc, at, error) VALUES (1, ?, ?, ?)`;
}

export function readQuarantineSql(): string {
	return `SELECT at FROM ${QUARANTINE_TABLE} WHERE id = 1`;
}

export function deleteSnapshotSql(): string {
	return `DELETE FROM ${SNAPSHOT_TABLE} WHERE id = 1`;
}

/** The part of `DurableObjectStorage` that a quarantine needs, which SQLite in Node can stand in for. */
export interface QuarantineStorage {
	sql: { exec(query: string, ...bindings: never[]): Iterable<unknown> };
	transactionSync<T>(closure: () => T): T;
}

/**
 * Moves a damaged snapshot out of the row a later save would overwrite.
 *
 * One transaction: the copy, the delete and the health row land together or not at all, so there
 * is no moment when the bytes are in neither table and a damaged row is only ever announced once.
 * With the quarantine taken nothing is moved, and the row stays where it is: the first copy is
 * kept and so is this one, at the cost of a room that refuses to save until someone clears it.
 *
 * A failed write throws, with everything rolled back, and the caller must then refuse every save.
 */
export function quarantineSnapshot(
	storage: QuarantineStorage,
	damaged: { stored: unknown; byteLength: number; error: string },
	now: number
): 'quarantined' | 'occupied' {
	const exec = storage.sql.exec.bind(storage.sql) as (
		query: string,
		...bindings: unknown[]
	) => Iterable<unknown>;
	return storage.transactionSync(() => {
		if ([...exec(readQuarantineSql())].length > 0) return 'occupied';
		exec(writeQuarantineSql(), damaged.stored, now, damaged.error);
		exec(deleteSnapshotSql());
		exec(writeHealthSql(), 'degraded', damaged.byteLength, now, UNREADABLE_REASON);
		return 'quarantined';
	});
}

/** The whole document as a single update, ready to store. */
export function encodeSnapshot(doc: Y.Doc): Uint8Array {
	return Y.encodeStateAsUpdate(doc);
}

/**
 * What a save may write, encoded and proven to load, or the reason it may not.
 *
 * A hostile update can apply to a live document, and encode, and still produce bytes that throw
 * when loaded into a fresh one. So every save loads what it is about to write, at whatever size,
 * since a room that skipped this would lose its last good row to exactly the update that passed.
 * The exception is a snapshot over the ceiling, which is not going to be written at all.
 *
 * Reloading doubles the work of a save, and ADR 0010 has what that costs. Only a throw counts. The
 * reloaded state vector is deliberately not compared with the live one, because they can honestly
 * differ: a reload can integrate structs the live document still holds pending. That was 101
 * saves in 1,117,089 of an honest fuzz, and it would have stopped those rooms saving.
 *
 * Total, because it runs where a throw lands in y-partyserver's swallow, and a document can also
 * be in a state that will not encode at all.
 */
export function prepareSnapshot(doc: Y.Doc): {
	bytes: Uint8Array;
	size: SnapshotSize;
	unreadable: boolean;
} {
	let bytes: Uint8Array;
	try {
		bytes = encodeSnapshot(doc);
	} catch {
		return { bytes: new Uint8Array(), size: 'ok', unreadable: true };
	}
	const size = classifySnapshot(bytes.byteLength);
	if (size === 'over') return { bytes, size, unreadable: false };
	try {
		Y.applyUpdate(new Y.Doc(), bytes);
		return { bytes, size, unreadable: false };
	} catch {
		return { bytes, size, unreadable: true };
	}
}

/** What a stored snapshot turned out to be. `doc` is always safe to start a room from. */
export type StoredSnapshot =
	/** Nothing has ever been saved here, or nothing worth keeping. */
	| { status: 'fresh'; doc: Y.Doc; byteLength: 0 }
	| { status: 'good'; doc: Y.Doc; byteLength: number }
	/** `doc` is empty, and `stored` is the value exactly as it was read, which must not be lost. */
	| { status: 'damaged'; doc: Y.Doc; stored: unknown; byteLength: number; error: string };

/**
 * Rebuilds a document from a stored snapshot, and says which of three things it found.
 *
 * SQLite hands blobs back as `ArrayBuffer`, so accept either that or a view. The empty document it
 * gives for a damaged row is still the right one to start from, because a room that cannot start
 * cannot be recovered, and the clients re-sync the workspace on connect. What matters is that the
 * caller moves the row out of the way first (`quarantineSnapshot`), since the room's next save
 * would otherwise replace it, and a room that treated these two empties as one lost the workspace
 * to a single bad row, in silence.
 *
 * Encoding counts as loading: y-partyserver encodes the document `onLoad` returns, outside any
 * catch, so one that decodes and will not encode would stop the room starting at all.
 */
export function decodeSnapshot(stored: unknown): StoredSnapshot {
	if (stored === undefined || stored === null) {
		return { status: 'fresh', doc: new Y.Doc(), byteLength: 0 };
	}
	const bytes = toBytes(stored);
	if (bytes === null) {
		return {
			status: 'damaged',
			doc: new Y.Doc(),
			stored,
			byteLength: typeof stored === 'string' ? stored.length : 0,
			error: `a stored value of type ${typeof stored}`
		};
	}
	if (bytes.byteLength === 0) return { status: 'fresh', doc: new Y.Doc(), byteLength: 0 };
	const doc = new Y.Doc();
	try {
		Y.applyUpdate(doc, bytes);
		return { status: 'good', doc, byteLength: encodeSnapshot(doc).byteLength };
	} catch (err) {
		return {
			status: 'damaged',
			doc: new Y.Doc(),
			stored,
			byteLength: bytes.byteLength,
			error: errorText(err)
		};
	}
}

/** An error as a short string, for a row or a log line. Total, as `classifyWriteError` is. */
export function errorText(err: unknown): string {
	try {
		return String((err as { message?: unknown })?.message ?? err).slice(0, 200);
	} catch {
		return 'unknown';
	}
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
