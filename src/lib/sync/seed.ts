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

/** Cheap deterministic PRNG; the data only needs to look varied, not be random. */
function makeRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 0x100000000;
	};
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

	let max: string | null = null;
	for (const yIssue of map.values()) {
		const order = yIssue.get('order');
		if (typeof order === 'string' && order !== '' && (max === null || order > max)) max = order;
	}

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
