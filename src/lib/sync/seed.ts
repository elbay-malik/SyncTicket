// Bulk issue generation, for benchmarking a large workspace and (from Phase 12) for the
// demo workspace a first-time visitor lands in.
//
// Creating issues one at a time through createIssue would open 10,000 Yjs transactions and
// scan the whole map for a maximum order key each time. This does one transaction and mints
// the keys in a single pass, which is the difference between a few seconds and a few tens
// of milliseconds.

import { generateNKeysBetween } from 'fractional-indexing';
import * as Y from 'yjs';
import {
	ISSUE_PRIORITIES,
	ISSUE_STATUSES,
	type IssuePriority,
	type IssueStatus
} from '$lib/model/issue.js';
import type { YIssue } from './doc.js';

const SUBJECTS = [
	'Login',
	'Sync',
	'Search',
	'Board',
	'Export',
	'Onboarding',
	'Billing',
	'Notifications',
	'Keyboard shortcuts',
	'Offline mode'
];

const VERBS = [
	'is slow on',
	'crashes when opening',
	'loses focus in',
	'renders twice in',
	'needs a spinner for',
	'drops updates from',
	'misreports counts in',
	'ignores the escape key in'
];

const LABELS = ['bug', 'ui', 'sync', 'perf', 'a11y', 'docs'];

export interface SeedOptions {
	/** Deterministic when supplied, so a benchmark can be repeated exactly. */
	seed?: number;
}

/**
 * A curated backlog for the empty state's "Load example issues" button.
 *
 * Deliberately hand-written rather than run through `seedIssues`' combinatorial generator:
 * that one exists to produce 10,000 items nobody reads individually, and it shows —
 * "Login is slow on issue #1" is filler grammar, fine at benchmark scale and not fine as the
 * first thing an evaluator reads. This list is short enough that every title has to be one a
 * person would actually write, and spans every status and a mix of priorities, labels and
 * assignees so the board and the filters both have something to show off immediately.
 */
const DEMO_ISSUES: ReadonlyArray<{
	title: string;
	description?: string;
	status: IssueStatus;
	priority: IssuePriority;
	assignee?: string;
	labels?: string[];
}> = [
	{
		title: 'Board column drag is broken on Firefox',
		description: 'Dropping a card past the last item snaps it back to where it started.',
		status: 'in_progress',
		priority: 'high',
		assignee: 'Mia',
		labels: ['bug', 'ui']
	},
	{
		title: 'Add keyboard shortcut for archiving an issue',
		status: 'backlog',
		priority: 'low',
		labels: ['keyboard']
	},
	{
		title: 'Search results flash empty before showing matches',
		description: 'Only on the very first keystroke after a page reload.',
		status: 'todo',
		priority: 'medium',
		assignee: 'Priya',
		labels: ['bug', 'perf']
	},
	{
		title: 'Offline banner never disappears after reconnecting',
		status: 'done',
		priority: 'urgent',
		assignee: 'Priya',
		labels: ['bug', 'sync']
	},
	{
		title: 'Support pasting a multi-line list into the quick-add field',
		description: 'Each line should become its own issue.',
		status: 'backlog',
		priority: 'low'
	},
	{
		title: 'Dark mode: priority icons are unreadable at low contrast',
		status: 'todo',
		priority: 'medium',
		assignee: 'Sam',
		labels: ['ui', 'a11y']
	},
	{
		title: "Export a workspace's issues as CSV",
		status: 'backlog',
		priority: 'none',
		labels: ['docs']
	},
	{
		title: 'Duplicate issue detection when titles are near-identical',
		status: 'canceled',
		priority: 'low',
		description: 'Tried a similarity threshold; too many false positives to be useful.'
	},
	{
		title: 'Assignee avatar missing for names with special characters',
		status: 'in_progress',
		priority: 'high',
		assignee: 'Zoë',
		labels: ['bug']
	},
	{
		title: 'Onboarding: first-time visitors miss the share button',
		status: 'todo',
		priority: 'medium',
		labels: ['ui']
	},
	{
		title: 'Notification sound plays twice on rapid updates',
		status: 'backlog',
		priority: 'low',
		labels: ['bug']
	},
	{
		title: 'Add a weekly digest of what changed in a workspace',
		status: 'backlog',
		priority: 'none',
		labels: ['docs']
	},
	{
		title: 'Command palette should remember the last search term',
		status: 'done',
		priority: 'low',
		assignee: 'Mia'
	},
	{
		title: 'Board columns are cramped on a 13-inch laptop screen',
		status: 'todo',
		priority: 'medium',
		labels: ['ui']
	}
];

/** Cheap deterministic PRNG; the data only needs to look varied, not be random. */
function makeRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 0x100000000;
	};
}

/** The current highest order key in the map, or null for an empty one. Shared by both seeders. */
function maxOrderKey(map: Y.Map<YIssue>): string | null {
	let max: string | null = null;
	for (const yIssue of map.values()) {
		const order = yIssue.get('order');
		if (typeof order === 'string' && order !== '' && (max === null || order > max)) max = order;
	}
	return max;
}

/**
 * Appends `count` generated issues in one transaction and returns their ids.
 *
 * Order keys come from a single `generateNKeysBetween` run rather than the jittered
 * `appendOrderKey`: seeding is a local bulk import, so there is no concurrent replica to
 * collide with, and 10,000 calls into the random-number generator is pure cost.
 */
export function seedIssues(map: Y.Map<YIssue>, count: number, options: SeedOptions = {}): string[] {
	if (count <= 0) return [];
	const doc = map.doc;
	if (!doc) throw new Error('issues map is not attached to a Y.Doc');

	const max = maxOrderKey(map);
	const random = makeRandom(options.seed ?? 1);
	const keys = generateNKeysBetween(max, null, count);
	const now = Date.now();
	const ids: string[] = [];

	doc.transact(() => {
		for (let index = 0; index < count; index += 1) {
			const id = crypto.randomUUID();
			const subject = SUBJECTS[Math.floor(random() * SUBJECTS.length)] ?? 'Sync';
			const verb = VERBS[Math.floor(random() * VERBS.length)] ?? 'is slow on';
			const status = ISSUE_STATUSES[Math.floor(random() * ISSUE_STATUSES.length)] as IssueStatus;
			const priority = ISSUE_PRIORITIES[
				Math.floor(random() * ISSUE_PRIORITIES.length)
			] as IssuePriority;
			const labelCount = Math.floor(random() * 3);
			const labels: string[] = [];
			for (let i = 0; i < labelCount; i += 1) {
				const label = LABELS[Math.floor(random() * LABELS.length)];
				if (label && !labels.includes(label)) labels.push(label);
			}

			const yIssue = new Y.Map<unknown>();
			map.set(id, yIssue);
			yIssue.set('title', `${subject} ${verb} issue #${index + 1}`);
			yIssue.set('description', '');
			yIssue.set('status', status);
			yIssue.set('priority', priority);
			yIssue.set('assignee', null);
			yIssue.set('labels', labels);
			yIssue.set('order', keys[index] ?? '');
			yIssue.set('createdAt', now - (count - index) * 1000);
			yIssue.set('updatedAt', now - (count - index) * 1000);
			ids.push(id);
		}
	});

	return ids;
}

/**
 * Appends the curated {@link DEMO_ISSUES} list in one transaction and returns their ids.
 *
 * Called only from the empty state's "Load example issues" button
 * (`routes/issues/+layout.svelte`) — never automatically. `query.total === 0` is also true
 * for a brand-new workspace, and several e2e suites assert a fresh workspace starts empty;
 * auto-seeding would break that contract for every one of them. This has to stay something
 * a visitor asks for, not something that happens to them.
 */
export function seedDemoIssues(map: Y.Map<YIssue>): string[] {
	const doc = map.doc;
	if (!doc) throw new Error('issues map is not attached to a Y.Doc');

	const keys = generateNKeysBetween(maxOrderKey(map), null, DEMO_ISSUES.length);
	const now = Date.now();
	const ids: string[] = [];

	doc.transact(() => {
		DEMO_ISSUES.forEach((issue, index) => {
			const id = crypto.randomUUID();
			const yIssue = new Y.Map<unknown>();
			map.set(id, yIssue);
			yIssue.set('title', issue.title);
			yIssue.set('description', issue.description ?? '');
			yIssue.set('status', issue.status);
			yIssue.set('priority', issue.priority);
			yIssue.set('assignee', issue.assignee ?? null);
			yIssue.set('labels', issue.labels ?? []);
			yIssue.set('order', keys[index] ?? '');
			// Staggered rather than identical, so a freshly seeded workspace sorts by
			// "recent" the same way real, gradually-created issues would.
			yIssue.set('createdAt', now - (DEMO_ISSUES.length - index) * 60_000);
			yIssue.set('updatedAt', now - (DEMO_ISSUES.length - index) * 60_000);
			ids.push(id);
		});
	});

	return ids;
}
