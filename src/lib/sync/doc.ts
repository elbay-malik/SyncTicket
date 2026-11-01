// The Yjs document is the single source of truth for a workspace. A workspace doc holds
// one top-level Y.Map ("issues") whose values should be per-issue Y.Maps of scalar fields.
//
// "Should", because anyone holding the link can write anything there, and the type parameter
// of a Y.Map is only a cast: it checks nothing that arrives over the wire. So `IssuesMap` says
// `unknown`, which leaves the compiler insisting that every read go through the helpers below.
//
// An entry that is not a Y.Map is ignored, not repaired, and it stays in the document: a CRDT
// has no way to drop it short of writing a delete, and nobody asked for that write. A peer can
// replace it later by writing a real issue over the same key.

import * as Y from 'yjs';

export const ISSUES_KEY = 'issues';

/** A single issue's CRDT representation: a Y.Map of scalar fields keyed by field name. */
export type YIssue = Y.Map<unknown>;

/** The top-level map, holding whatever peers have put there. Read it with the helpers below. */
export type IssuesMap = Y.Map<unknown>;

export function createDoc(): Y.Doc {
	return new Y.Doc();
}

export function getIssuesMap(doc: Y.Doc): IssuesMap {
	return doc.getMap<unknown>(ISSUES_KEY);
}

/**
 * Whether a value under `issues` is an issue at all.
 *
 * Duck-typing on `.get` is not enough: Y.Array, Y.XmlFragment and a sub-document all have a
 * `.get` that takes a read of `title` without complaint, which is a ghost row rather than a
 * crash, and it only throws once someone edits it.
 */
export function isYIssue(value: unknown): value is YIssue {
	return value instanceof Y.Map;
}

/** The issue under `id`, or undefined when there is none or the entry is not an issue. */
export function getYIssue(map: IssuesMap, id: string): YIssue | undefined {
	const value = map.get(id);
	return isYIssue(value) ? value : undefined;
}

/** Every entry under `issues` that is an issue, skipping the rest. */
export function* yIssues(map: IssuesMap): Generator<[id: string, yIssue: YIssue]> {
	for (const [id, value] of map) if (isYIssue(value)) yield [id, value];
}
