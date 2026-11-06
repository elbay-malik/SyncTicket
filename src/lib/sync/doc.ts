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
 * Undo and redo, one step at a time, whatever Yjs would rather do.
 *
 * `UndoManager.undo()` keeps popping until a step changes something. A step changes nothing when
 * a peer has since overwritten what it wrote, because Yjs refuses to restore over a newer value
 * from another client. So after a colleague renames an issue you just renamed, undo skips your
 * rename and takes back whatever you did before it: the issue's creation, or a whole batch of
 * example issues, deleted for everyone by a keypress that was aimed at a title.
 *
 * Yjs has no option for this, so the rest of the stack is hidden while the top step runs. A step
 * that turns out to change nothing is simply spent, and the next press is the visitor's own
 * decision. Listeners fire while the stack is short, so a caller that mirrors `canUndo` must read
 * it again afterwards.
 */
export function undoOneStep(undo: Y.UndoManager): void {
	withOnlyTopStep(undo, undo.undoStack, () => undo.undo());
}

/** {@link undoOneStep} for redo, which falls through in the same way. */
export function redoOneStep(undo: Y.UndoManager): void {
	withOnlyTopStep(undo, undo.redoStack, () => undo.redo());
}

function withOnlyTopStep<T>(undo: Y.UndoManager, stack: T[], run: () => void): void {
	const below = stack.splice(0, stack.length - 1);
	try {
		run();
	} finally {
		stack.unshift(...below);
		// A spent step runs no transaction, so Yjs does not reset its merge window, and a quick next
		// write would join whatever older step is now on top.
		undo.stopCapturing();
	}
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

/** The entries under `issues` that a batch of deep events touched, and the event that said so. */
export interface TouchedEntry {
	id: string;
	event: Y.YEvent<Y.AbstractType<unknown>>;
}

/**
 * Each entry under `issues` that `events` touched, once, with the first event to touch it. Yjs
 * delivers them shallowest first, so that is the event nearest the entry.
 *
 * Not `event.path[0]`: a path is worked out from the event's target every time it is asked for, so
 * a peer who touches every level of a deep chain made reading them quadratic at best, for one id.
 * Walking up instead, and remembering each type passed on the way, visits each type once.
 */
export function touchedEntries(
	map: IssuesMap,
	events: ReadonlyArray<Y.YEvent<Y.AbstractType<unknown>>>
): TouchedEntry[] {
	const touched = new Map<string, TouchedEntry>();
	const touch = (id: string, event: TouchedEntry['event']) => {
		if (!touched.has(id)) touched.set(id, { id, event });
	};
	const owners = new Map<Y.AbstractType<unknown>, string>();
	for (const event of events) {
		if (event.target === map) {
			for (const key of event.changes.keys.keys()) touch(key, event);
			continue;
		}
		const walked: Array<Y.AbstractType<unknown>> = [];
		let current = event.target;
		let id = owners.get(current);
		while (id === undefined) {
			walked.push(current);
			const item = current._item as Y.Item;
			if (item.parent === map) id = item.parentSub as string;
			else {
				current = item.parent as Y.AbstractType<unknown>;
				id = owners.get(current);
			}
		}
		for (const type of walked) owners.set(type, id);
		touch(id, event);
	}
	return [...touched.values()];
}
