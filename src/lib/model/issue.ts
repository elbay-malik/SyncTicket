// Plain domain model — no Yjs, no Svelte. The CRDT layer (src/lib/sync) serialises
// to and from these types; the UI and tests depend only on this file.

export const ISSUE_STATUSES = ['backlog', 'todo', 'in_progress', 'done', 'canceled'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

export interface Issue {
	id: string;
	title: string;
	description: string;
	status: IssueStatus;
	priority: IssuePriority;
	assignee: string | null;
	labels: string[];
	/** Fractional index (lexicographically orderable) for manual ordering. */
	order: string;
	createdAt: number;
	updatedAt: number;
}

/** Fields a caller may set when creating an issue; everything else is defaulted. */
export type NewIssueInput = Partial<
	Pick<Issue, 'title' | 'description' | 'status' | 'priority' | 'assignee' | 'labels'>
>;

/** Fields that may be changed on an existing issue. */
export type IssuePatch = Partial<
	Pick<Issue, 'title' | 'description' | 'status' | 'priority' | 'assignee' | 'labels'>
>;

export const STATUS_META: Record<IssueStatus, { label: string }> = {
	backlog: { label: 'Backlog' },
	todo: { label: 'Todo' },
	in_progress: { label: 'In Progress' },
	done: { label: 'Done' },
	canceled: { label: 'Canceled' }
};

export const PRIORITY_META: Record<IssuePriority, { label: string }> = {
	none: { label: 'No priority' },
	low: { label: 'Low' },
	medium: { label: 'Medium' },
	high: { label: 'High' },
	urgent: { label: 'Urgent' }
};

/** Higher rank = more urgent; used for priority sorting. */
export const PRIORITY_RANK: Record<IssuePriority, number> = {
	none: 0,
	low: 1,
	medium: 2,
	high: 3,
	urgent: 4
};

export const DEFAULT_STATUS: IssueStatus = 'backlog';
export const DEFAULT_PRIORITY: IssuePriority = 'none';

export function isIssueStatus(value: unknown): value is IssueStatus {
	return typeof value === 'string' && (ISSUE_STATUSES as readonly string[]).includes(value);
}

export function isIssuePriority(value: unknown): value is IssuePriority {
	return typeof value === 'string' && (ISSUE_PRIORITIES as readonly string[]).includes(value);
}
