// @ts-expect-error -- this package has no Node types: its program is the worker's, not its tests'.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
	SNAPSHOT_BUDGET_BYTES,
	SNAPSHOT_MAX_BYTES,
	SNAPSHOT_WARN_BYTES,
	classifySnapshot,
	classifyWriteError,
	createHealthTableSql,
	createQuarantineTableSql,
	createTableSql,
	decodeSnapshot,
	encodePersistenceNotice,
	encodeSnapshot,
	errorText,
	prepareSnapshot,
	quarantineSnapshot,
	readHealthSql,
	UNREADABLE_REASON,
	WAKE_WARN_STRUCTS,
	approxWakeMs,
	countStructs,
	writeQuarantineSql,
	writeSnapshotSql,
	type QuarantineStorage
} from './storage.js';
import { UNRELOADABLE_BASE, UNRELOADABLE_UPDATE } from './unreloadable.fixture.js';

function docWith(entries: Record<string, string>): Y.Doc {
	const doc = new Y.Doc();
	const map = doc.getMap<string>('issues');
	doc.transact(() => {
		for (const [key, value] of Object.entries(entries)) map.set(key, value);
	});
	return doc;
}

const contents = (doc: Y.Doc) => Object.fromEntries(doc.getMap<string>('issues').entries());

describe('snapshot round trip', () => {
	it('restores a document exactly', () => {
		const original = docWith({ a: 'one', b: 'two' });
		const restored = decodeSnapshot(encodeSnapshot(original)).doc;
		expect(contents(restored)).toEqual({ a: 'one', b: 'two' });
	});

	it('accepts the ArrayBuffer that SQLite actually returns', () => {
		const bytes = encodeSnapshot(docWith({ a: 'one' }));
		const asArrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
		expect(contents(decodeSnapshot(asArrayBuffer).doc)).toEqual({ a: 'one' });
	});

	it('starts empty rather than refusing to start when there is nothing usable', () => {
		// A room that cannot decode its snapshot must still accept connections; the clients
		// still hold the document and will re-sync it.
		for (const input of [
			null,
			undefined,
			'not bytes',
			new Uint8Array(),
			new Uint8Array([1, 2, 3])
		]) {
			expect(contents(decodeSnapshot(input).doc)).toEqual({});
		}
	});

	it('survives a document rebuilt from two merged replicas', () => {
		const a = docWith({ a: 'from A' });
		const b = docWith({ b: 'from B' });
		Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
		expect(contents(decodeSnapshot(encodeSnapshot(a)).doc)).toEqual({ a: 'from A', b: 'from B' });
	});

	it('keeps the workspace when the snapshot holds a struct of no length', () => {
		// A GC of length 0 and the delete-set entry it implies, as a poisoned room saved them. The
		// entry used to throw once the structs had landed, and the room woke up empty.
		const state = encodeSnapshot(docWith({ a: 'one', b: 'two' }));
		const client = [0xe1, 0x3c];
		const poisoned = Uint8Array.from([
			2,
			...state.slice(1, -1),
			1,
			...client,
			0,
			0,
			0,
			1,
			...client,
			1,
			0,
			0
		]);
		expect(contents(decodeSnapshot(poisoned).doc)).toEqual({ a: 'one', b: 'two' });
	});

	it('keeps the workspace when a peer has nested types deeper than the stack and deleted them', () => {
		// Tombstones kept, which is what makes the rebuild walk the whole tree. A throw there used to
		// come out of decodeSnapshot as an empty document, and the room forgot everything it held.
		const doc = new Y.Doc({ gc: false });
		const map = doc.getMap<unknown>('issues');
		map.set('kept', 'still here');
		const top = new Y.Map<unknown>();
		map.set('deep', top);
		doc.transact(() => {
			let current = top;
			for (let level = 1; level < 3_000; level += 1) {
				const next = new Y.Map<unknown>();
				current.set('n', next);
				current = next;
			}
		});
		map.delete('deep');

		expect(contents(decodeSnapshot(encodeSnapshot(doc)).doc)).toEqual({ kept: 'still here' });
	});
});

describe('what a stored snapshot turned out to be', () => {
	it('calls no row, and a row of no bytes, fresh', () => {
		for (const stored of [undefined, null, new Uint8Array(), new ArrayBuffer(0)]) {
			const read = decodeSnapshot(stored);
			expect(read.status).toBe('fresh');
			expect(contents(read.doc)).toEqual({});
		}
	});

	it('calls an empty document good, which is two bytes and not nothing', () => {
		const bytes = encodeSnapshot(new Y.Doc());
		expect(bytes.byteLength).toBeGreaterThan(0);
		expect(decodeSnapshot(bytes).status).toBe('good');
	});

	it('calls a row that decodes good, and measures it', () => {
		const bytes = encodeSnapshot(docWith({ a: 'one' }));
		const read = decodeSnapshot(bytes);
		expect(read.status).toBe('good');
		expect(read.byteLength).toBe(bytes.byteLength);
		expect(contents(read.doc)).toEqual({ a: 'one' });
	});

	it('calls non-empty bytes that throw damaged, and hands them back untouched', () => {
		const bytes = new Uint8Array([1, 2, 3]);
		const read = decodeSnapshot(bytes);
		if (read.status !== 'damaged') throw new Error(`expected damaged, got ${read.status}`);
		expect(read.stored).toBe(bytes);
		expect(read.byteLength).toBe(3);
		expect(read.error).not.toBe('');
		expect(contents(read.doc)).toEqual({});
	});

	it('calls a value of any other type damaged, rather than nothing', () => {
		for (const stored of ['not bytes', '', 42, 0, {}, true]) {
			const read = decodeSnapshot(stored);
			if (read.status !== 'damaged') throw new Error(`expected damaged for ${String(stored)}`);
			expect(read.stored).toBe(stored);
			expect(contents(read.doc)).toEqual({});
		}
	});

	it('does not start a room from a half-applied document', () => {
		// Real bytes, with something in them that integrates before the part that throws.
		const read = decodeSnapshot(poisonedLiveDoc().encoded);
		expect(read.status).toBe('damaged');
		expect(contents(read.doc)).toEqual({});
		expect(countStructs(read.doc)).toBe(0);
	});
});

/**
 * A room holding real work when the real update arrives. It stays usable, as a live room does:
 * nothing throws until the bytes it encodes are loaded into something new.
 */
function poisonedLiveDoc(): { live: Y.Doc; encoded: Uint8Array } {
	const live = docWith({ kept: 'real work' });
	Y.applyUpdate(live, UNRELOADABLE_BASE);
	Y.applyUpdate(live, UNRELOADABLE_UPDATE);
	return { live, encoded: Y.encodeStateAsUpdate(live) };
}

describe('the 227-byte update', () => {
	it('is the real thing: it applies live, encodes, and throws on reload', () => {
		expect(UNRELOADABLE_UPDATE.byteLength).toBe(227);
		const { live, encoded } = poisonedLiveDoc();
		expect(live.getMap('issues').get('kept')).toBe('real work');
		expect(() => Y.applyUpdate(new Y.Doc(), encoded)).toThrow();
	});

	it('is harmless without the document it was reduced against, in either direction', () => {
		const alone = new Y.Doc();
		Y.applyUpdate(alone, UNRELOADABLE_UPDATE);
		expect(decodeSnapshot(encodeSnapshot(alone)).status).toBe('good');
		expect(prepareSnapshot(alone).unreadable).toBe(false);

		const base = new Y.Doc();
		Y.applyUpdate(base, UNRELOADABLE_BASE);
		expect(prepareSnapshot(base).unreadable).toBe(false);
	});
});

describe('prepareSnapshot', () => {
	it('passes an ordinary document, with the bytes to write', () => {
		const doc = docWith({ a: 'one' });
		const { bytes, size, unreadable } = prepareSnapshot(doc);
		expect(unreadable).toBe(false);
		expect(size).toBe('ok');
		expect(contents(decodeSnapshot(bytes).doc)).toEqual({ a: 'one' });
	});

	it('refuses what will not reload', () => {
		expect(prepareSnapshot(poisonedLiveDoc().live).unreadable).toBe(true);
	});

	it('does not throw when the document will not even encode', () => {
		// onSave calling this is all that stands between a hostile state and y-partyserver's swallow.
		const doc = docWith({ a: 'one' });
		(doc as unknown as { store: unknown }).store = null;
		expect(() => Y.encodeStateAsUpdate(doc)).toThrow();
		expect(prepareSnapshot(doc)).toEqual({ bytes: new Uint8Array(), size: 'ok', unreadable: true });
	});

	it('does not spend a reload on a snapshot that is not going to be written', () => {
		// Poisoned as well as oversized, so a reload would have thrown and said so.
		const { live } = poisonedLiveDoc();
		live.getMap<string>('issues').set('large', 'x'.repeat(SNAPSHOT_MAX_BYTES + 1));
		const { size, unreadable } = prepareSnapshot(live);
		expect(size).toBe('over');
		expect(unreadable).toBe(false);
	});

	it('passes a document holding pending structs and deletes, which honest rooms do', () => {
		// Out-of-order delivery. A check that disagreed here would stop an honest room saving.
		const writer = new Y.Doc();
		const updates: Uint8Array[] = [];
		writer.on('update', (update: Uint8Array) => updates.push(update));
		const map = writer.getMap<string>('issues');
		map.set('a', 'one');
		map.set('b', 'two');
		map.delete('a');
		map.set('c', 'three');

		const room = new Y.Doc();
		for (const update of updates.slice(1)) Y.applyUpdate(room, update);
		expect(room.store.pendingStructs).not.toBeNull();
		expect(room.store.pendingDs).not.toBeNull();
		expect(prepareSnapshot(room).unreadable).toBe(false);

		// And nothing was lost by going through a save: the missing update completes the reload.
		const reloaded = decodeSnapshot(prepareSnapshot(room).bytes).doc;
		Y.applyUpdate(reloaded, updates[0] as Uint8Array);
		expect(contents(reloaded)).toEqual({ b: 'two', c: 'three' });
	});
});

describe('errorText', () => {
	it('is short, and total', () => {
		expect(errorText(new Error('x'.repeat(1_000)))).toHaveLength(200);
		expect(errorText('plain')).toBe('plain');
		expect(errorText(undefined)).toBe('undefined');
		expect(
			errorText({
				get message(): string {
					throw new Error('nope');
				}
			})
		).toBe('unknown');
	});
});

describe('quarantineSnapshot', () => {
	/** The room's own tables in real SQLite, with what the Durable Object API gives on top. */
	function room(): { storage: QuarantineStorage; database: DatabaseSync } {
		const database = new DatabaseSync(':memory:');
		const exec = (query: string, ...bindings: unknown[]) => {
			const statement = database.prepare(query);
			return statement.columns().length > 0
				? statement.all(...bindings)
				: (statement.run(...bindings), []);
		};
		const storage = {
			sql: { exec },
			transactionSync<T>(closure: () => T): T {
				database.exec('BEGIN');
				try {
					const result = closure();
					database.exec('COMMIT');
					return result;
				} catch (err) {
					database.exec('ROLLBACK');
					throw err;
				}
			}
		} as unknown as QuarantineStorage;
		for (const sql of [createTableSql(), createHealthTableSql(), createQuarantineTableSql()]) {
			exec(sql);
		}
		return { storage, database };
	}

	const store = (database: DatabaseSync, value: unknown) =>
		database.prepare(writeSnapshotSql()).run(value);
	const one = (database: DatabaseSync, sql: string) => database.prepare(sql).get();
	const snapshotRow = (database: DatabaseSync) =>
		one(database, 'SELECT doc FROM ydoc_snapshot WHERE id = 1');
	const quarantineRow = (database: DatabaseSync) =>
		one(database, 'SELECT doc, at, error FROM ydoc_quarantine WHERE id = 1');
	const damaged = (stored: unknown) => {
		const read = decodeSnapshot(stored);
		if (read.status !== 'damaged') throw new Error('expected damaged');
		return read;
	};

	it('moves the row, and records why, in one step', () => {
		const { storage, database } = room();
		const bytes = new Uint8Array([1, 2, 3]);
		store(database, bytes);

		expect(quarantineSnapshot(storage, damaged(bytes), 1_000)).toBe('quarantined');

		expect(snapshotRow(database)).toBeUndefined();
		const kept = quarantineRow(database);
		expect(new Uint8Array(kept.doc)).toEqual(bytes);
		expect(kept.at).toBe(1_000);
		expect(kept.error).not.toBe('');
		expect(one(database, readHealthSql())).toMatchObject({
			state: 'degraded',
			bytes: 3,
			at: 1_000,
			reason: UNREADABLE_REASON
		});
	});

	it('keeps a value that was not bytes, as what it was', () => {
		const { storage, database } = room();
		store(database, 'not bytes');
		expect(quarantineSnapshot(storage, damaged('not bytes'), 1_000)).toBe('quarantined');
		expect(quarantineRow(database).doc).toBe('not bytes');
		expect(snapshotRow(database)).toBeUndefined();
	});

	it('never overwrites the first copy, and leaves the later one where it is', () => {
		const { storage, database } = room();
		const first = new Uint8Array([1, 2, 3]);
		const later = new Uint8Array([4, 5, 6]);
		store(database, first);
		quarantineSnapshot(storage, damaged(first), 1_000);
		store(database, later);

		expect(quarantineSnapshot(storage, damaged(later), 2_000)).toBe('occupied');

		expect(new Uint8Array(quarantineRow(database).doc)).toEqual(first);
		expect(quarantineRow(database).at).toBe(1_000);
		expect(new Uint8Array(snapshotRow(database).doc)).toEqual(later);
	});

	it('cannot overwrite the first copy even if asked to directly', () => {
		const { database } = room();
		const write = database.prepare(writeQuarantineSql());
		write.run(new Uint8Array([1]), 1, null);
		expect(() => write.run(new Uint8Array([2]), 2, null)).toThrow(/UNIQUE|constraint/i);
		expect(new Uint8Array(quarantineRow(database).doc)).toEqual(new Uint8Array([1]));
	});

	it('throws with nothing changed when the copy cannot be written', () => {
		const { storage, database } = room();
		database.exec('DROP TABLE ydoc_quarantine');
		database.exec(
			'CREATE TABLE ydoc_quarantine (id INTEGER PRIMARY KEY, doc BLOB NOT NULL CHECK (0), at INTEGER NOT NULL, error TEXT)'
		);
		const bytes = new Uint8Array([1, 2, 3]);
		store(database, bytes);

		expect(() => quarantineSnapshot(storage, damaged(bytes), 1_000)).toThrow();

		expect(new Uint8Array(snapshotRow(database).doc)).toEqual(bytes);
		expect(quarantineRow(database)).toBeUndefined();
		expect(one(database, readHealthSql())).toBeUndefined();
	});

	it('throws with nothing changed when a later step in the transaction fails', () => {
		// The copy goes in first, so this is the case a missing rollback would get wrong.
		const { storage, database } = room();
		database.exec('DROP TABLE ydoc_health');
		const bytes = new Uint8Array([1, 2, 3]);
		store(database, bytes);

		expect(() => quarantineSnapshot(storage, damaged(bytes), 1_000)).toThrow();

		expect(new Uint8Array(snapshotRow(database).doc)).toEqual(bytes);
		expect(quarantineRow(database)).toBeUndefined();
	});
});

describe('snapshot sizes', () => {
	it('is the documented cap, in the units Cloudflare documents it in', () => {
		// Cloudflare's own footnote defines 1 GB as 1,000,000,000 bytes.
		expect(SNAPSHOT_BUDGET_BYTES).toBe(2_000_000);
	});

	it('leaves headroom and does not reclaim it', () => {
		expect(SNAPSHOT_WARN_BYTES).toBeLessThan(SNAPSHOT_MAX_BYTES);
		expect(SNAPSHOT_MAX_BYTES).toBeLessThan(SNAPSHOT_BUDGET_BYTES);
		// 2_199_994 is what local workerd happens to accept (a SQLITE_MAX_LENGTH build
		// constant, not a contract); 2_097_152 is 2 MiB, i.e. the unit confusion. Neither is
		// a number any constant here is allowed to become.
		for (const forbidden of [2_199_994, 2_097_152]) {
			expect([SNAPSHOT_BUDGET_BYTES, SNAPSHOT_MAX_BYTES, SNAPSHOT_WARN_BYTES]).not.toContain(
				forbidden
			);
		}
	});

	it('classifies both boundaries exactly', () => {
		expect(classifySnapshot(SNAPSHOT_WARN_BYTES - 1)).toBe('ok');
		expect(classifySnapshot(SNAPSHOT_WARN_BYTES)).toBe('ok');
		expect(classifySnapshot(SNAPSHOT_WARN_BYTES + 1)).toBe('warn');
		expect(classifySnapshot(SNAPSHOT_MAX_BYTES - 1)).toBe('warn');
		expect(classifySnapshot(SNAPSHOT_MAX_BYTES)).toBe('warn');
		expect(classifySnapshot(SNAPSHOT_MAX_BYTES + 1)).toBe('over');
	});

	it('classifies the trivial cases', () => {
		expect(classifySnapshot(0)).toBe('ok');
		expect(classifySnapshot(SNAPSHOT_BUDGET_BYTES)).toBe('over');
	});
});

describe('classifyWriteError', () => {
	it('recognises the message workerd actually produces', () => {
		// Measured locally: a plain Error, no `.code`, no own enumerable properties. The
		// message substring is the only discriminator that exists.
		expect(classifyWriteError(new Error('string or blob too big: SQLITE_TOOBIG'))).toBe('too-big');
		expect(classifyWriteError('SQLITE_TOOBIG')).toBe('too-big');
	});

	it('is total, and never throws on hostile input', () => {
		for (const err of [
			new Error('database or disk is full: SQLITE_FULL'),
			new Error('anything else'),
			'a bare string',
			undefined,
			null,
			{},
			0,
			Symbol('nope'),
			{
				get message(): string {
					throw new Error('nope');
				}
			}
		]) {
			expect(classifyWriteError(err)).toBe('unknown');
		}
	});
});

describe('the wire contract', () => {
	it('encodes the exact literal the client half parses', () => {
		// `src/lib/sync/relay-notice.ts` asserts the same literal parses back. The two
		// workers share no code; this pair of assertions is the only guard on that.
		expect(
			encodePersistenceNotice({ state: 'degraded', reason: 'too-big', at: 1700000000000 })
		).toBe('{"v":1,"type":"persistence","state":"degraded","reason":"too-big","at":1700000000000}');
	});

	it('omits the reason when nothing is wrong', () => {
		expect(encodePersistenceNotice({ state: 'ok', at: 1700000000000 })).toBe(
			'{"v":1,"type":"persistence","state":"ok","at":1700000000000}'
		);
	});
});

describe('real documents against the ceiling', () => {
	/** The shape `sync/issues.ts` writes: one `issues` map, one sub-map per issue. */
	function docWithIssues(count: number): Y.Doc {
		const doc = new Y.Doc();
		const issues = doc.getMap('issues');
		doc.transact(() => {
			for (let i = 0; i < count; i++) {
				const issue = new Y.Map<unknown>();
				issue.set('title', `Issue ${i}`);
				issue.set('description', '');
				issue.set('status', 'todo');
				issue.set('priority', 'medium');
				issue.set('assignee', null);
				issue.set('labels', []);
				issue.set('order', `a${i.toString(36)}`);
				issue.set('createdAt', 1700000000000);
				issue.set('updatedAt', 1700000000000);
				issues.set(`i${String(i).padStart(10, '0')}`, issue);
			}
		});
		return doc;
	}

	it('fits 2,000 never-edited issues and refuses 5,000', () => {
		// The numbers behind the decision to report the ceiling rather than raise it. Empty
		// descriptions are the most favourable case there is, and 5,000 issues still cannot
		// be stored.
		expect(classifySnapshot(encodeSnapshot(docWithIssues(2_000)).byteLength)).toBe('ok');
		expect(classifySnapshot(encodeSnapshot(docWithIssues(5_000)).byteLength)).toBe('over');
	});
});

describe('wake cost, which the byte guard cannot see', () => {
	function docWithIssues(count: number): Y.Doc {
		const doc = new Y.Doc();
		const issues = doc.getMap('issues');
		doc.transact(() => {
			for (let i = 0; i < count; i++) {
				const issue = new Y.Map<unknown>();
				issue.set('title', `Issue ${i}`);
				issue.set('description', '');
				issue.set('status', 'todo');
				issue.set('priority', 'medium');
				issue.set('assignee', null);
				issue.set('labels', []);
				issue.set('order', `a${i.toString(36)}`);
				issue.set('createdAt', 1700000000000);
				issue.set('updatedAt', 1700000000000);
				issues.set(`i${String(i).padStart(10, '0')}`, issue);
			}
		});
		return doc;
	}

	it('counts ten structs per issue — the sub-map plus its nine fields', () => {
		expect(countStructs(docWithIssues(100))).toBe(1_000);
		expect(countStructs(docWithIssues(500))).toBe(5_000);
	});

	it('keeps counting structs that gc has already emptied of content', () => {
		// The reason this is not derived from bytes. gc reclaims the *content* of deleted
		// issues — ~95% of it — but never the structs, so a churned workspace stays expensive
		// to wake while shrinking on disk. 500 live issues plus 1,500 created-and-deleted:
		const doc = docWithIssues(500);
		const issues = doc.getMap('issues');
		doc.transact(() => {
			for (let i = 0; i < 1_500; i++) {
				issues.set(`tmp${i}`, new Y.Map<unknown>());
				issues.delete(`tmp${i}`);
			}
		});
		expect(countStructs(doc)).toBeGreaterThan(6_000);
	});

	it('sees a document the byte guard calls fine', () => {
		// 2,300 empty-description issues: under SNAPSHOT_WARN_BYTES, and over the wake
		// threshold. Exactly the blind spot this axis exists for.
		const doc = docWithIssues(2_300);
		expect(classifySnapshot(encodeSnapshot(doc).byteLength)).toBe('ok');
		expect(countStructs(doc)).toBeGreaterThan(WAKE_WARN_STRUCTS);
	});

	it('reports a whole number of milliseconds, and nothing clever', () => {
		expect(approxWakeMs(30_000)).toBe(18);
		expect(approxWakeMs(0)).toBe(0);
	});
});
