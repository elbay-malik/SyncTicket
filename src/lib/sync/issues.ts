// CRDT read/write helpers: the only place that knows how an Issue is serialised into a
// Y.Map. Operating on Yjs types (not runes) keeps this unit-testable without a browser.
//
// Conflict semantics: every scalar field is a last-writer-wins register (Y.Map). Whole
// issues merge structurally — concurrent creates never collide (distinct UUID keys), and
// concurrent edits to different fields of one issue both survive.

import * as Y from 'yjs';
import {
	DEFAULT_PRIORITY,
	DEFAULT_STATUS,
	isIssuePriority,
	isIssueStatus,
	type Issue,
	type IssuePatch,
	type IssuePriority,
	type IssueStatus,
	type NewIssueInput
} from '$lib/model/issue.js';
import { labelsEqual } from '$lib/model/labels.js';
import { randomUUID } from '$lib/model/uuid.js';
import { getYIssue, yIssues, type IssuesMap, type YIssue } from './doc.js';
import { appendOrderKey, isOrderKey, orderKeyBetween, planRepairs, type Ordered } from './order.js';

function requireDoc(map: IssuesMap): Y.Doc {
	const doc = map.doc;
	if (!doc) throw new Error('issues map is not attached to a Y.Doc');
	return doc;
}

function readString(yIssue: YIssue, key: string, fallback: string): string {
	const value = yIssue.get(key);
	return typeof value === 'string' ? value : fallback;
}

/** The last time a Date can hold, either side of the epoch. ECMAScript fixes it at this. */
const MAX_TIME = 8.64e15;

/**
 * A stored time, or `fallback` when a Date couldn't hold what a peer left there, so nothing past
 * this point has to wonder: `toISOString` throws out of range, in the middle of rendering, and
 * patchIssue never writes `createdAt`, so no edit would ever clear it.
 */
function readTime(yIssue: YIssue, key: string, fallback: number): number {
	const value = yIssue.get(key);
	return typeof value === 'number' && Math.abs(value) <= MAX_TIME ? value : fallback;
}

function readStatus(yIssue: YIssue): IssueStatus {
	const value = yIssue.get('status');
	return isIssueStatus(value) ? value : DEFAULT_STATUS;
}

function readPriority(yIssue: YIssue): IssuePriority {
	const value = yIssue.get('priority');
	return isIssuePriority(value) ? value : DEFAULT_PRIORITY;
}

function readAssignee(yIssue: YIssue): string | null {
	const value = yIssue.get('assignee');
	return typeof value === 'string' ? value : null;
}

/**
 * An issue's labels: strings only, each once, first occurrence winning. The UI dedupes what it
 * writes, but a peer's array arrives as it was sent, and the views key their badges by the text,
 * so a repeat would throw each_key_duplicate on every load. Compares the raw strings: unlike
 * parseLabels it doesn't trim, because ' bug' and 'bug' are different keys and nothing here throws.
 */
function readLabels(yIssue: YIssue): string[] {
	const value = yIssue.get('labels');
	if (!Array.isArray(value)) return [];
	return [...new Set(value.filter((item): item is string => typeof item === 'string'))];
}

/**
 * An issue's order key, or '' when what a peer left there is not one. Nothing that goes on to
 * compute a key may read the field any other way, because fractional-indexing throws on a bad
 * bound or returns garbage. The bad key stays in the document until a move replaces it.
 */
function readOrder(yIssue: YIssue): string {
	const value = yIssue.get('order');
	return typeof value === 'string' && isOrderKey(value) ? value : '';
}

/** Deserialise one issue Y.Map into a plain Issue, tolerating missing/corrupt fields. */
export function readIssue(id: string, yIssue: YIssue): Issue {
	const createdAt = readTime(yIssue, 'createdAt', 0);
	return {
		id,
		title: readString(yIssue, 'title', 'Untitled'),
		description: readString(yIssue, 'description', ''),
		status: readStatus(yIssue),
		priority: readPriority(yIssue),
		assignee: readAssignee(yIssue),
		labels: readLabels(yIssue),
		order: readOrder(yIssue),
		createdAt,
		updatedAt: readTime(yIssue, 'updatedAt', createdAt)
	};
}

export function readAllIssues(map: IssuesMap): Issue[] {
	const issues: Issue[] = [];
	for (const [id, yIssue] of yIssues(map)) issues.push(readIssue(id, yIssue));
	return issues;
}

/** The highest valid order key in the map, or null when there is none. */
export function maxOrderKey(map: IssuesMap): string | null {
	let max: string | null = null;
	for (const [, yIssue] of yIssues(map)) {
		const order = readOrder(yIssue);
		if (order !== '' && (max === null || order > max)) max = order;
	}
	return max;
}

/** Fractional key that sorts after every existing issue (appends to the end). */
export function nextOrderKey(map: IssuesMap): string {
	return appendOrderKey(maxOrderKey(map));
}

/** Creates an issue and returns its id. All field writes happen in one transaction. */
export function createIssue(map: IssuesMap, input: NewIssueInput = {}): string {
	const doc = requireDoc(map);
	const id = randomUUID();
	const now = Date.now();
	const order = nextOrderKey(map);
	doc.transact(() => {
		const yIssue = new Y.Map<unknown>();
		map.set(id, yIssue);
		yIssue.set('title', (input.title ?? '').trim() || 'Untitled');
		yIssue.set('description', input.description ?? '');
		yIssue.set('status', input.status ?? DEFAULT_STATUS);
		yIssue.set('priority', input.priority ?? DEFAULT_PRIORITY);
		yIssue.set('assignee', input.assignee ?? null);
		yIssue.set('labels', input.labels ?? []);
		yIssue.set('order', order);
		yIssue.set('createdAt', now);
		yIssue.set('updatedAt', now);
	});
	return id;
}

const PATCH_KEYS = ['title', 'description', 'status', 'priority', 'assignee', 'labels'] as const;

/** True when writing `next` to `key` would not change what readIssue() reports. */
function isUnchanged(yIssue: YIssue, key: (typeof PATCH_KEYS)[number], next: unknown): boolean {
	if (key === 'labels') {
		return Array.isArray(next) && labelsEqual(readLabels(yIssue), next as string[]);
	}
	return yIssue.get(key) === next;
}

/**
 * Applies a partial update to an existing issue and bumps updatedAt.
 *
 * Three invariants live here rather than in the UI, so every caller gets them:
 * - An empty patch is a no-op. Touching updatedAt on a write that changed nothing would
 *   reshuffle the "recent" sort for free.
 * - Fields already equal to their stored value are dropped. Every write is a new Y item —
 *   an IndexedDB row now, a relay message and a fresh last-writer-wins clobber window from
 *   Phase 9 — so a picker re-selecting the current status must cost nothing.
 * - A title is trimmed, and a blank one is ignored. `readIssue` only defaults a *missing*
 *   title to "Untitled", so persisting '' would render an empty row forever.
 */
export function patchIssue(map: IssuesMap, id: string, patch: IssuePatch): void {
	const yIssue = getYIssue(map, id);
	if (!yIssue) return;
	const writes: Array<[(typeof PATCH_KEYS)[number], unknown]> = [];
	for (const key of PATCH_KEYS) {
		let next: unknown = patch[key];
		if (next === undefined) continue;
		if (key === 'title') {
			next = (next as string).trim();
			if (!next) continue;
		}
		if (isUnchanged(yIssue, key, next)) continue;
		writes.push([key, next]);
	}
	if (writes.length === 0) return;
	const doc = requireDoc(map);
	doc.transact(() => {
		for (const [key, value] of writes) yIssue.set(key, value);
		yIssue.set('updatedAt', Date.now());
	});
}

/** Deletes an issue. An entry that is not one is ignored like everywhere else (see doc.ts). */
export function deleteIssue(map: IssuesMap, id: string): void {
	if (getYIssue(map, id)) map.delete(id);
}

/**
 * Moves an issue to `status` at a position described by `orderedIds` — the target column's
 * ids in their new display order, including the moved issue. The caller (the board) knows
 * where the card landed; every key decision happens here.
 *
 * The moved issue's own key is excluded before computing neighbours: it is the one key
 * that is deliberately out of place, so feeding it to planRepairs would rekey the column
 * around it. The remaining siblings are already consistent, so repairs are almost always
 * empty — they exist for keys minted concurrently on another replica, where a drop between
 * two equal keys would otherwise throw.
 *
 * Repairs and the move go in one transaction, so observers see a single coherent batch.
 * A pure reorder does not bump `updatedAt`: dragging a card is not an edit to the issue,
 * and bumping it would make the "Recently updated" sort thrash while tidying a board.
 */
export function moveIssue(
	map: IssuesMap,
	id: string,
	status: IssueStatus,
	orderedIds: readonly string[]
): void {
	const yIssue = getYIssue(map, id);
	if (!yIssue) return;

	// The position is counted among the siblings that exist rather than taken from `orderedIds`:
	// an id with no issue behind it would otherwise leave it one too far along.
	let index = -1;
	const siblings: Ordered[] = [];
	for (const siblingId of orderedIds) {
		if (siblingId === id) {
			if (index === -1) index = siblings.length;
			continue;
		}
		const sibling = getYIssue(map, siblingId);
		if (sibling) siblings.push({ id: siblingId, order: readOrder(sibling) });
	}
	if (index === -1) return;

	const repairs = planRepairs(siblings);
	if (repairs.length > 0) {
		const repaired = new Map(repairs.map((repair) => [repair.id, repair.order]));
		for (const sibling of siblings) sibling.order = repaired.get(sibling.id) ?? sibling.order;
	}

	// Removing the moved issue shifts every later sibling left by one, so the item now at
	// `index` is exactly the one the card should sit in front of.
	const previous = index > 0 ? (siblings[index - 1]?.order ?? null) : null;
	const next = siblings[index]?.order ?? null;
	const statusChanged = yIssue.get('status') !== status;

	// A drag that changes nothing must cost nothing. Picking a card up and dropping it back,
	// or abandoning a drag outside every column, still fires a drop event — and because keys
	// carry random jitter the freshly computed one would differ from the stored one every
	// time, so comparing keys is not enough. Ask the question that actually matters: does the
	// key it already has put it where it now needs to be?
	const current = readOrder(yIssue);
	const alreadyInPlace =
		current !== '' &&
		(previous === null || current > previous) &&
		(next === null || current < next);
	if (!statusChanged && repairs.length === 0 && alreadyInPlace) return;

	const order = orderKeyBetween(previous, next);
	const doc = requireDoc(map);
	doc.transact(() => {
		for (const repair of repairs) getYIssue(map, repair.id)?.set('order', repair.order);
		yIssue.set('order', order);
		if (statusChanged) {
			yIssue.set('status', status);
			yIssue.set('updatedAt', Date.now());
		}
	});
}
