// Where a text field's selection belongs after its whole value is replaced by someone else's.
//
// Assigning `value` puts the caret at the end, which broke one case: someone who had selected
// the title to type over it typed onto the end of a peer's text instead. Keeping the old offsets
// broke the opposite one: a caret at the end stayed put when a longer value arrived, and the
// next words landed in the middle of it. So the selection follows the text it was next to.

export interface Selection {
	start: number;
	end: number;
}

/**
 * Maps a selection in `before` onto `after`.
 *
 * - Everything selected stays everything selected, so typing still replaces it.
 * - A caret at the end stays at the end, so typing carries on after the new text.
 * - Otherwise each end keeps its place relative to the text that did not change: unchanged
 *   text before it keeps it where it was, and a change before it shifts it by the change's
 *   length. An end inside the changed span goes to the end of the new span.
 */
export function mapSelection(before: string, after: string, selection: Selection): Selection {
	const { start, end } = selection;
	if (before.length > 0 && start === 0 && end === before.length) {
		return { start: 0, end: after.length };
	}
	if (start === end && end === before.length) return { start: after.length, end: after.length };

	const shortest = Math.min(before.length, after.length);
	let prefix = 0;
	while (prefix < shortest && before[prefix] === after[prefix]) prefix += 1;
	let suffix = 0;
	while (
		suffix < shortest - prefix &&
		before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
	) {
		suffix += 1;
	}

	const map = (offset: number) => {
		if (offset <= prefix) return offset;
		if (offset >= before.length - suffix) return offset + after.length - before.length;
		return after.length - suffix;
	};
	return { start: map(start), end: map(end) };
}
