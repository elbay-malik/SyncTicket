// The Yjs document is the single source of truth for a workspace. A workspace doc holds
// one top-level Y.Map ("issues") whose values should be per-issue Y.Maps of scalar fields.
//
// "Should", because anyone holding the link can write anything there, and the type parameter
// of a Y.Map is only a cast: it checks nothing that arrives over the wire. So `IssuesMap` says
// `unknown`, which leaves the compiler insisting that every read go through the helpers below.
//
// An entry that is not an issue is ignored, not repaired, and it stays in the document: a CRDT
// has no way to drop it short of writing a delete, and nobody asked for that write. A peer can
// replace it later by writing a real issue over the same key, if the key is a real id.

import * as Y from 'yjs';
import { isIssueId } from '$lib/model/issue.js';

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
 * An undo stack for what `origin` writes, and nothing else.
 *
 * It names its origin rather than taking Yjs's default, which tracks every transaction with no
 * origin. That covers more than a visitor's edits: when two peers format a Y.Text at once, Yjs tidies
 * up on each replica that receives them, in a new local transaction with no origin, so a peer could
 * push a step onto anyone's stack and wipe their redo. Whatever writes under `origin` has to pass it
 * to `doc.transact`; a nested transaction joins the outermost one, whose origin is what counts.
 *
 * `captureTimeout` is 300ms rather than the 500ms default so that typing a title and then changing
 * a status are two undo steps rather than one.
 */
export function createUndoManager(map: IssuesMap, origin: object): Y.UndoManager {
	return new Y.UndoManager(map, { captureTimeout: 300, trackedOrigins: new Set([origin]) });
}

/**
 * Whether an entry under `issues` is an issue at all: a Y.Map, under a key that is an issue id.
 *
 * Duck-typing on `.get` is not enough: Y.Array, Y.XmlFragment and a sub-document all have a
 * `.get` that takes a read of `title` without complaint, which is a ghost row rather than a
 * crash, and it only throws once someone edits it.
 *
 * The key is checked here as well because it is a peer's string that becomes the issue's id and
 * then a link: `../issues?ws=...` is a row whose title sends whoever clicks it to another
 * workspace, and `''` or `/x` make `resolve()` throw while the list renders.
 */
function isIssueEntry(id: string, value: unknown): value is YIssue {
	return isIssueId(id) && value instanceof Y.Map;
}

/** The issue under `id`, or undefined when there is none or the entry is not an issue. */
export function getYIssue(map: IssuesMap, id: string): YIssue | undefined {
	const value = map.get(id);
	return isIssueEntry(id, value) ? value : undefined;
}

/** Every entry under `issues` that is an issue, skipping the rest. */
export function* yIssues(map: IssuesMap): Generator<[id: string, yIssue: YIssue]> {
	for (const [id, value] of map) if (isIssueEntry(id, value)) yield [id, value];
}
