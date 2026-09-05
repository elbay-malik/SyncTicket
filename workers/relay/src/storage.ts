// Encoding a Yjs document for the room's SQLite table.
//
// Kept free of `partyserver` and `cloudflare:workers` imports so it can be unit-tested under
// plain Node: this is the part where a mistake is silent, because a corrupted snapshot only
// shows up as a room that has forgotten everything.

import * as Y from 'yjs';

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
