// Which drag events change the board, and which of them write to the CRDT.
//
// This is pure decision-making, kept out of the component so it can be tested in Node: the
// rules are subtle and every one of them was learned from svelte-dnd-action's source rather
// than guessed.
//
// A drag does not report itself the way you would expect:
// - A *keyboard* drop arrives as `consider` with trigger `dragStopped`. There is no closing
//   `finalize`, so a handler that only listens to `finalize` never learns the drag ended.
// - A keyboard drag fires `finalize` on every arrow press and on every Tab into a column.
//   Those are intermediate steps; committing each one would mint an order key per keystroke.
// - Releasing outside every column still fires `finalize`, with `droppedOutsideOfAny`. The
//   card goes back where it was, so nothing should be written.
// - A pointer drop fires `finalize` on the target column and the origin column. Only the one
//   whose items contain the dragged id describes where the card landed.

import { SOURCES, TRIGGERS, type DndEvent } from 'svelte-dnd-action';
import type { Issue, IssueStatus } from '$lib/model/issue.js';

/** What the board should do in response to one drag event. */
export type DragOutcome =
	/** Show these items in this column; the drag is still in flight. */
	| { kind: 'preview'; status: IssueStatus; items: Issue[] }
	/** The drag ended here: write it through, then drop every column's preview. */
	| { kind: 'commit'; status: IssueStatus; id: string; orderedIds: string[]; source: string }
	/** The drag ended without a change: drop every column's preview. */
	| { kind: 'end' };

function commitOrEnd(status: IssueStatus, detail: DndEvent<Issue>): DragOutcome {
	const { items, info } = detail;
	// Only the column holding the dragged card knows where it ended up.
	if (!items.some((item) => item.id === info.id)) return { kind: 'end' };
	return {
		kind: 'commit',
		status,
		id: info.id,
		orderedIds: items.map((item) => item.id),
		source: info.source
	};
}

/** Decides what a `consider` event means for `status`'s column. */
export function reduceConsider(status: IssueStatus, detail: DndEvent<Issue>): DragOutcome {
	if (detail.info.trigger === TRIGGERS.DRAG_STOPPED) return commitOrEnd(status, detail);
	return { kind: 'preview', status, items: detail.items };
}

/** Decides what a `finalize` event means for `status`'s column. */
export function reduceFinalize(status: IssueStatus, detail: DndEvent<Issue>): DragOutcome {
	if (detail.info.trigger === TRIGGERS.DROPPED_OUTSIDE_OF_ANY) return { kind: 'end' };
	if (detail.info.source === SOURCES.KEYBOARD) {
		return { kind: 'preview', status, items: detail.items };
	}
	return commitOrEnd(status, detail);
}
