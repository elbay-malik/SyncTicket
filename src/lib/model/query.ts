// Pure filter/sort/group functions over Issue arrays. No Yjs, no runes — the reactive
// query index (src/lib/state/queries.svelte.ts) wraps these in $derived.

import { ISSUE_STATUSES, PRIORITY_RANK, type Issue, type IssueStatus } from './issue.js';

export type IssueSort = 'manual' | 'priority' | 'recent';

export interface IssueFilter {
	status: IssueStatus | 'all';
	text: string;
}

export function filterIssues(issues: Issue[], filter: IssueFilter): Issue[] {
	const text = filter.text.trim().toLowerCase();
	return issues.filter((issue) => {
		if (filter.status !== 'all' && issue.status !== filter.status) return false;
		if (text) {
			const haystack = `${issue.title}\n${issue.description}`.toLowerCase();
			if (!haystack.includes(text)) return false;
		}
		return true;
	});
}

/**
 * Returns a new sorted array; the input is not mutated. Every path ends in a total order:
 * ties fall back to the fractional key, then to the issue id. The final id tiebreak is
 * load-bearing — two replicas can mint identical order keys for concurrently-created
 * issues, and without it their lists would diverge (Y.Map iteration order isn't stable
 * across replicas). Sorting by a stable unique id makes the display converge.
 */
export function sortIssues(issues: Issue[], sort: IssueSort): Issue[] {
	const byId = (a: Issue, b: Issue) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
	const byOrder = (a: Issue, b: Issue) =>
		a.order < b.order ? -1 : a.order > b.order ? 1 : byId(a, b);
	const sorted = [...issues];
	switch (sort) {
		case 'priority':
			sorted.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || byOrder(a, b));
			break;
		case 'recent':
			sorted.sort((a, b) => b.updatedAt - a.updatedAt || byOrder(a, b));
			break;
		case 'manual':
		default:
			sorted.sort(byOrder);
			break;
	}
	return sorted;
}

/** Groups issues by status (every status present, ordered manually within each). */
export function groupByStatus(issues: Issue[]): Record<IssueStatus, Issue[]> {
	const groups = Object.fromEntries(ISSUE_STATUSES.map((s) => [s, [] as Issue[]])) as Record<
		IssueStatus,
		Issue[]
	>;
	for (const issue of issues) groups[issue.status].push(issue);
	for (const status of ISSUE_STATUSES) groups[status] = sortIssues(groups[status], 'manual');
	return groups;
}

/** Count of issues per status. */
export function countByStatus(issues: Issue[]): Record<IssueStatus, number> {
	const counts = Object.fromEntries(ISSUE_STATUSES.map((s) => [s, 0])) as Record<
		IssueStatus,
		number
	>;
	for (const issue of issues) counts[issue.status] += 1;
	return counts;
}
