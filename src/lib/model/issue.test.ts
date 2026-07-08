import { describe, expect, it } from 'vitest';
import {
	ISSUE_PRIORITIES,
	ISSUE_STATUSES,
	PRIORITY_META,
	PRIORITY_RANK,
	STATUS_META,
	isIssuePriority,
	isIssueStatus
} from './issue.js';

describe('issue model', () => {
	it('guards status values', () => {
		expect(isIssueStatus('todo')).toBe(true);
		expect(isIssueStatus('in_progress')).toBe(true);
		expect(isIssueStatus('nonsense')).toBe(false);
		expect(isIssueStatus(42)).toBe(false);
		expect(isIssueStatus(null)).toBe(false);
	});

	it('guards priority values', () => {
		expect(isIssuePriority('urgent')).toBe(true);
		expect(isIssuePriority('none')).toBe(true);
		expect(isIssuePriority('critical')).toBe(false);
		expect(isIssuePriority(undefined)).toBe(false);
	});

	it('has a label for every status and priority', () => {
		for (const status of ISSUE_STATUSES) expect(STATUS_META[status].label).toBeTruthy();
		for (const priority of ISSUE_PRIORITIES) expect(PRIORITY_META[priority].label).toBeTruthy();
	});

	it('ranks priorities monotonically from none to urgent', () => {
		const ranks = ISSUE_PRIORITIES.map((p) => PRIORITY_RANK[p]);
		const ascending = [...ranks].sort((a, b) => a - b);
		expect(ranks).toEqual(ascending);
		expect(PRIORITY_RANK.urgent).toBeGreaterThan(PRIORITY_RANK.none);
	});
});
