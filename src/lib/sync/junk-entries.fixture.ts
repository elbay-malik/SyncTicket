// Test support, imported only by the junk-entry tests: the values a peer can store under
// `issues` that are not issue maps, and the way such a write really reaches another browser.

import * as Y from 'yjs';
import { ISSUES_KEY } from './doc.js';

/**
 * They do not all fail the same way, which is why every one is tried. A string, a number or a
 * Y.Text has no `.get`, so a read throws. A Y.Array, a Y.XmlFragment and a sub-document do have
 * one, so a read succeeds and yields a ghost row whose first edit throws instead. And null,
 * undefined and false are falsy, so `if (yIssue)` treats them as absent.
 */
export const JUNK_VALUES: ReadonlyArray<{ name: string; make: () => unknown }> = [
	{ name: 'a string', make: () => 'boom' },
	{ name: 'a number', make: () => 42 },
	{ name: 'false', make: () => false },
	{ name: 'null', make: () => null },
	{ name: 'undefined', make: () => undefined },
	{ name: 'a plain object', make: () => ({ title: 'Not a map', order: 'zz' }) },
	{ name: 'binary', make: () => new Uint8Array([1, 2, 3]) },
	{ name: 'a Y.Text', make: () => new Y.Text('boom') },
	{ name: 'a Y.Array', make: () => Y.Array.from(['boom']) },
	{ name: 'a Y.XmlFragment', make: () => new Y.XmlFragment() },
	{ name: 'a sub-document', make: () => new Y.Doc() }
];

/**
 * Runs `write` on a separate replica that has caught up with `target`, then delivers only what
 * it added, the way the relay would. `origin` is the transaction origin it arrives with.
 */
export function peerWrites(
	target: Y.Doc,
	write: (issues: Y.Map<unknown>) => void,
	origin?: unknown
): void {
	const peer = new Y.Doc();
	Y.applyUpdate(peer, Y.encodeStateAsUpdate(target));
	write(peer.getMap<unknown>(ISSUES_KEY));
	Y.applyUpdate(target, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(target)), origin);
}
