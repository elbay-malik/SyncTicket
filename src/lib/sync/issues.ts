// CRDT read/write helpers: the only place that knows how an Issue is serialised into a
// Y.Map. Operating on Yjs types (not runes) keeps this unit-testable without a browser.
//
// Conflict semantics: every scalar field is a last-writer-wins register (Y.Map). Whole
// issues merge structurally — concurrent creates never collide (distinct UUID keys), and
// concurrent edits to different fields of one issue both survive.

import { generateKeyBetween } from 'fractional-indexing';
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
import type { YIssue } from './doc.js';

function requireDoc(map: Y.Map<YIssue>): Y.Doc {
	const doc = map.doc;
	if (!doc) throw new Error('issues map is not attached to a Y.Doc');
	return doc;
}

function readString(yIssue: YIssue, key: string, fallback: string): string {
	const value = yIssue.get(key);
	return typeof value === 'string' ? value : fallback;
}

function readNumber(yIssue: YIssue, key: string, fallback: number): number {
	const value = yIssue.get(key);
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
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

function readLabels(yIssue: YIssue): string[] {
	const value = yIssue.get('labels');
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];
}

/** Deserialise one issue Y.Map into a plain Issue, tolerating missing/corrupt fields. */
export function readIssue(id: string, yIssue: YIssue): Issue {
	const createdAt = readNumber(yIssue, 'createdAt', 0);
	return {
		id,
		title: readString(yIssue, 'title', 'Untitled'),
		description: readString(yIssue, 'description', ''),
		status: readStatus(yIssue),
		priority: readPriority(yIssue),
		assignee: readAssignee(yIssue),
		labels: readLabels(yIssue),
		order: readString(yIssue, 'order', ''),
		createdAt,
		updatedAt: readNumber(yIssue, 'updatedAt', createdAt)
	};
}

export function readAllIssues(map: Y.Map<YIssue>): Issue[] {
	const issues: Issue[] = [];
	for (const [id, yIssue] of map) issues.push(readIssue(id, yIssue));
	return issues;
}

/** Fractional key that sorts after every existing issue (appends to the end). */
export function nextOrderKey(map: Y.Map<YIssue>): string {
	let max: string | null = null;
	for (const yIssue of map.values()) {
		const order = yIssue.get('order');
		if (typeof order === 'string' && (max === null || order > max)) max = order;
	}
	return generateKeyBetween(max, null);
}

/** Creates an issue and returns its id. All field writes happen in one transaction. */
export function createIssue(map: Y.Map<YIssue>, input: NewIssueInput = {}): string {
	const doc = requireDoc(map);
	const id = crypto.randomUUID();
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
export function patchIssue(map: Y.Map<YIssue>, id: string, patch: IssuePatch): void {
	const yIssue = map.get(id);
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

export function deleteIssue(map: Y.Map<YIssue>, id: string): void {
	if (map.has(id)) map.delete(id);
}
