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

/**
 * Nests `depth` maps under `key`, the way a peer can for about 12 bytes a level. Yjs takes it
 * without complaint, and its delete and collect walks are what used to run out of stack.
 */
export function nestMaps(parent: Y.Map<unknown>, key: string, depth: number): void {
	const nest = () => {
		let current = new Y.Map<unknown>();
		parent.set(key, current);
		for (let level = 1; level < depth; level += 1) {
			const next = new Y.Map<unknown>();
			current.set('n', next);
			current = next;
		}
	};
	if (parent.doc) parent.doc.transact(nest);
	else throw new Error('nestMaps needs a parent that is in a document');
}

/**
 * A chain written by two clients: `first` writes the issue and the top map, `second` nests `depth`
 * more under that, and `first` finishes with `leaf` at the very bottom. Undoing a delete of it visits
 * one client's items at a time, so `first`'s last item comes before the parents `second` wrote,
 * which is the order that used to recurse. A chain from one client is walked top-down and never did.
 */
export function splitChain(
	target: Y.Doc,
	depth: number,
	origin: unknown,
	clients: { first: number; second: number } = { first: 1, second: 2 }
): void {
	const first = new Y.Doc();
	first.clientID = clients.first;
	Y.applyUpdate(first, Y.encodeStateAsUpdate(target));
	const yIssue = wellFormedIssue({ title: 'Innocent' });
	first.getMap<unknown>(ISSUES_KEY).set(REAL_ID, yIssue);
	const top = new Y.Map<unknown>();
	yIssue.set('zzz', top);

	const second = new Y.Doc();
	second.clientID = clients.second;
	Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
	const theirIssue = second.getMap<Y.Map<unknown>>(ISSUES_KEY).get(REAL_ID) as Y.Map<unknown>;
	nestMaps(theirIssue.get('zzz') as Y.Map<unknown>, 'n', depth);

	Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
	let deepest = top;
	for (let next = deepest.get('n'); next instanceof Y.Map; next = deepest.get('n')) deepest = next;
	deepest.set('leaf', 'from the first client');
	yIssue.set('description', 'Written by the first client');

	Y.applyUpdate(target, Y.encodeStateAsUpdate(first, Y.encodeStateVector(target)), origin);
}

/**
 * What a peer sends to make every level of a chain produce an event: the chain, under an issue, and
 * then one transaction setting a key on each level. Types made in the transaction that made them
 * raise no event of their own, which is why it takes the second update.
 */
export function everyLevelTouched(depth: number): { chain: Uint8Array; touch: Uint8Array } {
	const peer = new Y.Doc();
	const yIssue = wellFormedIssue({ title: 'Innocent' });
	peer.getMap<unknown>(ISSUES_KEY).set(REAL_ID, yIssue);
	nestMaps(yIssue, 'zzz', depth);
	const chain = Y.encodeStateAsUpdate(peer);
	const since = Y.encodeStateVector(peer);
	peer.transact(() => {
		let level = yIssue.get('zzz');
		while (level instanceof Y.Map) {
			level.set('x', 1);
			level = level.get('n');
		}
	});
	return { chain, touch: Y.encodeStateAsUpdate(peer, since) };
}

/** How many maps hang under `zzz`, walked by hand, and what the last of them holds. */
export function chainUnder(yIssue: Y.Map<unknown>): { depth: number; leaf: unknown } {
	let depth = 0;
	let current = yIssue.get('zzz');
	let last: Y.Map<unknown> | null = null;
	while (current instanceof Y.Map) {
		depth += 1;
		last = current;
		current = current.get('n');
	}
	return { depth, leaf: last?.get('leaf') };
}

function varUint(value: number): number[] {
	const bytes: number[] = [];
	let rest = value;
	while (rest > 127) {
		bytes.push((rest % 128) | 128);
		rest = Math.floor(rest / 128);
	}
	bytes.push(rest);
	return bytes;
}

/** A v1 string: its UTF-8 length, then its bytes. */
function varString(text: string): Uint8Array {
	const bytes = new TextEncoder().encode(text);
	return concat([Uint8Array.from(varUint(bytes.length)), bytes]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
	const whole = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
	let at = 0;
	for (const part of parts) {
		whole.set(part, at);
		at += part.length;
	}
	return whole;
}

/**
 * Every kind of Yjs content that holds a plain value, as the bytes a peer's update carries. Written
 * by hand, because `Y.Map.set` only ever makes `any`, nothing in Yjs's API makes `json` any more, and
 * past about 6,000 levels its encoder overflows before anything leaves. Each takes a value already
 * in the form it is stored in: the JSON kinds a JSON text, `any` lib0's binary form.
 */
export const VALUE_CONTENT = {
	json: (text: string) => ({
		ref: 2,
		content: concat([Uint8Array.from(varUint(1)), varString(text)])
	}),
	embed: (text: string) => ({ ref: 5, content: varString(text) }),
	format: (text: string) => ({ ref: 6, content: concat([varString('bold'), varString(text)]) }),
	any: (bytes: Uint8Array) => ({ ref: 8, content: concat([Uint8Array.from(varUint(1)), bytes]) }),
	doc: (bytes: Uint8Array) => ({ ref: 9, content: concat([varString('sub'), bytes]) })
};

/** `depth` arrays inside each other as JSON, the innermost holding `core`. */
export function nestedJson(depth: number, core = ''): string {
	return `${'['.repeat(depth)}${core}${']'.repeat(depth)}`;
}

/** `depth` arrays, or objects keyed `a`, inside each other in lib0's binary form. */
export function nestedAny(depth: number, kind: 'array' | 'object' = 'array'): Uint8Array {
	const level = kind === 'array' ? [117, 1] : [118, 1, 1, 97];
	const bytes = new Uint8Array(depth * level.length + 1);
	for (let i = 0; i < depth; i += 1) bytes.set(level, i * level.length);
	bytes[bytes.length - 1] = 126;
	return bytes;
}

/**
 * One item in a v1 update, written out by hand: no neighbours, and `content` under a top-level
 * map's key, or under a key of the nested type that `parentId` created. The client id is fixed and
 * the clock is zero, so one document can only take one of these.
 */
export function handWrittenItem(
	content: { ref: number; content: Uint8Array },
	key: string,
	parentId?: { client: number; clock: number }
): Uint8Array {
	return handWrittenStructs([handWrittenStruct(content, key, parentId)]);
}

/** One item with the given content, as it sits among the structs of an update. */
export function handWrittenStruct(
	{ ref, content }: { ref: number; content: Uint8Array },
	key: string,
	parentId?: { client: number; clock: number }
): Uint8Array {
	const hasParentSub = 32;
	return concat([
		Uint8Array.from([hasParentSub | ref]),
		parentId
			? Uint8Array.from([0, ...varUint(parentId.client), ...varUint(parentId.clock)])
			: concat([Uint8Array.from([1]), varString('issues')]),
		varString(key),
		content
	]);
}

/** Structs in a row from the hand-writing client, the first at `clock`, in a v1 update. */
export function handWrittenStructs(structs: readonly Uint8Array[], clock = 0): Uint8Array {
	return concat([
		structsOfOneClient(structs, clock),
		// An empty delete set.
		Uint8Array.from([0])
	]);
}

function structsOfOneClient(structs: readonly Uint8Array[], clock: number): Uint8Array {
	return concat([
		Uint8Array.from([
			...varUint(1),
			...varUint(structs.length),
			...varUint(HAND_CLIENT),
			...varUint(clock)
		]),
		...structs
	]);
}

export const HAND_CLIENT = 7_777;

/** A plain value under a key of `issues`, one clock long, for standing next to the ones below. */
export function plainStruct(key: string, value: string): Uint8Array {
	const text = new TextEncoder().encode(value);
	return handWrittenStruct(
		VALUE_CONTENT.any(concat([Uint8Array.from([119, ...varUint(text.length)]), text])),
		key
	);
}

/**
 * Every struct a peer can write that takes up no clock. Yjs's own API never makes one, and its
 * encoder and its search through a client's structs both take a struct's length to be at least one.
 */
export const EMPTY_STRUCTS: ReadonlyArray<{ name: string; bytes: Uint8Array }> = [
	{ name: 'a GC', bytes: Uint8Array.from([0, 0]) },
	{ name: 'a Skip', bytes: Uint8Array.from([10, 0]) },
	{
		name: 'ContentAny of nothing',
		bytes: handWrittenStruct({ ref: 8, content: Uint8Array.from([0]) }, SLOT_ID)
	},
	{
		name: 'ContentJSON of nothing',
		bytes: handWrittenStruct({ ref: 2, content: Uint8Array.from([0]) }, SLOT_ID)
	},
	{
		name: 'an empty ContentString',
		bytes: handWrittenStruct({ ref: 4, content: varString('') }, SLOT_ID)
	},
	{
		name: 'ContentDeleted of nothing',
		bytes: handWrittenStruct({ ref: 1, content: Uint8Array.from([0]) }, SLOT_ID)
	}
];

/**
 * A delete set of one client's `[clock, length]` ranges, in the v1 format. Length zero is the part
 * that matters: Yjs's own v2 format cannot say it, and its v2 encoder throws when asked to.
 */
export function deleteSetOf(client: number, ranges: ReadonlyArray<[number, number]>): Uint8Array {
	return Uint8Array.from(
		[1, client, ranges.length, ...ranges.flat()].flatMap((value) => varUint(value))
	);
}

/**
 * What a replica holding an empty GC used to save: `state` as an update, the empty GC among its
 * structs and the delete-set entry it implies. `state` must have no deletes of its own.
 */
export function poisonedSnapshot(state: Uint8Array): Uint8Array {
	return concat([
		Uint8Array.from([2]),
		state.slice(1, -1),
		Uint8Array.from([...varUint(1), ...varUint(HAND_CLIENT), 0]),
		Uint8Array.from([0, 0]),
		deleteSetOf(HAND_CLIENT, [[0, 0]])
	]);
}

/**
 * Everything `peer` has written since `since`, with all of it already deleted, in one update. Its
 * own Yjs never runs the delete, so the delete set is written out by hand in the v1 format: no
 * structs, one client, one range.
 */
export function treeAndItsDelete(peer: Y.Doc, since: Uint8Array): Uint8Array {
	const from = Y.decodeStateVector(since).get(peer.clientID) ?? 0;
	const to = Y.getState(peer.store, peer.clientID);
	const deletion = Uint8Array.from(
		[0, 1, peer.clientID, 1, from, to - from].flatMap((value) => varUint(value))
	);
	return Y.mergeUpdates([Y.encodeStateAsUpdate(peer, since), deletion]);
}
