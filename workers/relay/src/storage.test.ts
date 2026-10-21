import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
	SNAPSHOT_BUDGET_BYTES,
	SNAPSHOT_MAX_BYTES,
	SNAPSHOT_WARN_BYTES,
	classifySnapshot,
	classifyWriteError,
	decodeSnapshot,
	encodePersistenceNotice,
	encodeSnapshot
} from './storage.js';

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
		const restored = decodeSnapshot(encodeSnapshot(original));
		expect(contents(restored)).toEqual({ a: 'one', b: 'two' });
	});

	it('accepts the ArrayBuffer that SQLite actually returns', () => {
		const bytes = encodeSnapshot(docWith({ a: 'one' }));
		const asArrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
		expect(contents(decodeSnapshot(asArrayBuffer))).toEqual({ a: 'one' });
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
			expect(contents(decodeSnapshot(input))).toEqual({});
		}
	});

	it('survives a document rebuilt from two merged replicas', () => {
		const a = docWith({ a: 'from A' });
		const b = docWith({ b: 'from B' });
		Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
		expect(contents(decodeSnapshot(encodeSnapshot(a)))).toEqual({ a: 'from A', b: 'from B' });
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

	it('fits 5,000 never-edited issues and refuses 10,000', () => {
		// The numbers behind the decision to report the ceiling rather than raise it. Empty
		// descriptions are the most favourable case there is, and 10,000 issues still cannot
		// be stored.
		expect(classifySnapshot(encodeSnapshot(docWithIssues(5_000)).byteLength)).toBe('ok');
		expect(classifySnapshot(encodeSnapshot(docWithIssues(10_000)).byteLength)).toBe('over');
	});
});
