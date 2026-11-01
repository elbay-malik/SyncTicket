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

const ISSUE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Whether a value is an issue id this app could have minted: the lowercase form that
 * `crypto.randomUUID()` produces, which is how every issue has been created from the start.
 *
 * Ids are Y.Map keys, so a peer chooses them, and they end up in links. Only the shape is
 * checked, not the version nibble: nothing depends on it, and a UUID is already harmless.
 */
export function isIssueId(value: unknown): value is string {
	return typeof value === 'string' && ISSUE_ID.test(value);
}

/**
 * An issue id as `resolve('/issues/[id]', ...)` needs it.
 *
 * `resolve` pastes a parameter into the path as it is, so a `/` or a `?` in the id would change
 * where the link goes. SvelteKit decodes the segment again for `page.params.id`, and a real id
 * has nothing to encode, so its link is unchanged. Reads filter out anything else (`sync/doc.ts`)
 * and this is the second layer behind that: it does nothing for `''` or `..`, which only the
 * filter can stop, because a browser treats an encoded dot segment as a dot segment too.
 */
export function issueIdParam(id: string): string {
	return encodeURIComponent(id);
}
