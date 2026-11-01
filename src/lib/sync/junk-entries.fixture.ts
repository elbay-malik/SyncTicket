// Test support, imported only by the tests of what a peer can store under `issues`: the values
// that are not issue maps, the keys that are not ids, and how such a write really reaches another
// browser.

import * as Y from 'yjs';
import { ISSUES_KEY } from './doc.js';

/**
 * Keys that are real ids, for tests about the value under them. A key like 'junk' would no longer
 * prove anything about the value, because it is turned away for the key alone.
 */
export const JUNK_ID = '00000000-0000-4000-8000-00000000000a';
export const SLOT_ID = '00000000-0000-4000-8000-00000000000b';
export const REAL_ID = '00000000-0000-4000-8000-00000000000c';

/** Where the audit's exploit sends whoever clicks the row. */
export const STOLEN_LINK = `../issues?ws=w${'deadbeef'.repeat(4)}`;

/**
 * Keys a peer can write an otherwise perfect issue under, none of which is an id. The first four
 * are the audit's: a link into another workspace, and three that make `resolve()` throw. The
 * rest are near misses for the pattern, including what the audit's looser one let through.
 */
export const BAD_IDS: readonly string[] = [
	STOLEN_LINK,
	'',
	'/x',
	'x/',
	'corrupt',
	'.',
	'..',
	'%2e%2e%2fissues',
	'\0',
	'__proto__',
	'-'.repeat(36),
	'a'.repeat(36),
	'00000000-0000-4000-8000-00000000000A',
	'00000000000040008000000000000000a',
	'{00000000-0000-4000-8000-00000000000a}',
	'00000000-0000-4000-8000-00000000000a\n',
	'\n00000000-0000-4000-8000-00000000000a',
	'00000000-0000-4000-8000-00000000000a\nx',
	'x\n00000000-0000-4000-8000-00000000000a'
];

/** A complete, valid-looking issue for one of those keys, as a peer would write it. */
export function wellFormedIssue(fields: Record<string, unknown> = {}): Y.Map<unknown> {
	const yIssue = new Y.Map<unknown>();
	yIssue.set('title', 'Fix login');
	yIssue.set('description', '');
	yIssue.set('status', 'todo');
	yIssue.set('priority', 'none');
	yIssue.set('assignee', null);
	yIssue.set('labels', []);
	yIssue.set('createdAt', 1);
	yIssue.set('updatedAt', 1);
	for (const [field, value] of Object.entries(fields)) yIssue.set(field, value);
	return yIssue;
}

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
