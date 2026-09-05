import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { decodeSnapshot, encodeSnapshot } from './storage.js';

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
