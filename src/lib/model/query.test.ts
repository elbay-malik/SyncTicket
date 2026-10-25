import { describe, expect, it } from 'vitest';
import type { Issue } from './issue.js';
import {
	countByStatus,
	filterIssues,
	groupByStatus,
	sectionByStatus,
	sortIssues
} from './query.js';

function mk(over: Partial<Issue>): Issue {
	return {
		id: crypto.randomUUID(),
		title: 'Untitled',
		description: '',
		status: 'backlog',
		priority: 'none',
		assignee: null,
		labels: [],
		order: 'a0',
		createdAt: 0,
		updatedAt: 0,
		...over
	};
}

describe('filterIssues', () => {
	it('filters by status', () => {
		const issues = [mk({ status: 'todo' }), mk({ status: 'done' }), mk({ status: 'todo' })];
		expect(filterIssues(issues, { status: 'todo', text: '' })).toHaveLength(2);
		expect(filterIssues(issues, { status: 'all', text: '' })).toHaveLength(3);
	});

	it('filters by text across title and description (case-insensitive)', () => {
		const issues = [
			mk({ title: 'Fix Login bug' }),
			mk({ title: 'Add feature', description: 'improves LOGIN flow' }),
			mk({ title: 'Unrelated' })
		];
		expect(filterIssues(issues, { status: 'all', text: 'login' })).toHaveLength(2);
		expect(filterIssues(issues, { status: 'all', text: '  ' })).toHaveLength(3);
	});
});

describe('sortIssues', () => {
	it('orders manually by fractional key', () => {
		const issues = [mk({ order: 'a2' }), mk({ order: 'a0' }), mk({ order: 'a1' })];
		expect(sortIssues(issues, 'manual').map((i) => i.order)).toEqual(['a0', 'a1', 'a2']);
	});

	it('orders by priority (most urgent first), ties by manual order', () => {
		const issues = [
			mk({ priority: 'low', order: 'a0' }),
			mk({ priority: 'urgent', order: 'a1' }),
			mk({ priority: 'urgent', order: 'a0' })
		];
		expect(sortIssues(issues, 'priority').map((i) => `${i.priority}:${i.order}`)).toEqual([
			'urgent:a0',
			'urgent:a1',
			'low:a0'
		]);
	});

	it('orders by most recently updated', () => {
		const issues = [mk({ updatedAt: 10 }), mk({ updatedAt: 30 }), mk({ updatedAt: 20 })];
		expect(sortIssues(issues, 'recent').map((i) => i.updatedAt)).toEqual([30, 20, 10]);
	});

	it('does not mutate the input array', () => {
		const issues = [mk({ order: 'a2' }), mk({ order: 'a0' })];
		const snapshot = issues.map((i) => i.order);
		sortIssues(issues, 'manual');
		expect(issues.map((i) => i.order)).toEqual(snapshot);
	});

	it('breaks equal order keys by id so the result is a total, input-independent order', () => {
		const a = mk({ id: 'zzz', order: 'a0' });
		const b = mk({ id: 'aaa', order: 'a0' });
		expect(sortIssues([a, b], 'manual').map((i) => i.id)).toEqual(['aaa', 'zzz']);
		expect(sortIssues([b, a], 'manual').map((i) => i.id)).toEqual(['aaa', 'zzz']);
		// Priority/recent inherit the same final tiebreak.
		expect(sortIssues([a, b], 'recent').map((i) => i.id)).toEqual(['aaa', 'zzz']);
	});
});

describe('groupByStatus / countByStatus', () => {
	it('groups every status and orders within a group', () => {
		const issues = [
			mk({ status: 'todo', order: 'a1' }),
			mk({ status: 'todo', order: 'a0' }),
			mk({ status: 'done', order: 'a0' })
		];
		const grouped = groupByStatus(issues);
		expect(grouped.todo.map((i) => i.order)).toEqual(['a0', 'a1']);
		expect(grouped.done).toHaveLength(1);
		expect(grouped.backlog).toHaveLength(0);
	});

	it('counts issues per status', () => {
		const issues = [mk({ status: 'todo' }), mk({ status: 'todo' }), mk({ status: 'canceled' })];
		const counts = countByStatus(issues);
		expect(counts.todo).toBe(2);
		expect(counts.canceled).toBe(1);
		expect(counts.backlog).toBe(0);
	});
});

describe('sectionByStatus', () => {
	const shape = (entries: ReturnType<typeof sectionByStatus>) =>
		entries.map((entry) =>
			entry.kind === 'section' ? `# ${entry.status} ${entry.count}` : entry.issue.title
		);

	it('heads each status in board column order and skips the empty ones', () => {
		const issues = [
			mk({ title: 'shipped', status: 'done' }),
			mk({ title: 'idea', status: 'backlog' }),
			mk({ title: 'doing', status: 'in_progress' })
		];
		expect(shape(sectionByStatus(issues))).toEqual([
			'# backlog 1',
			'idea',
			'# in_progress 1',
			'doing',
			'# done 1',
			'shipped'
		]);
	});

	it("keeps the caller's sort inside each section rather than re-sorting", () => {
		// Deliberately not in order-key order: the sections must not quietly undo a priority
		// or recency sort by falling back to the board's own ordering.
		const issues = [
			mk({ title: 'b-later', status: 'todo', order: 'a0' }),
			mk({ title: 'a-other', status: 'backlog' }),
			mk({ title: 'b-first', status: 'todo', order: 'a5' })
		];
		expect(shape(sectionByStatus(issues))).toEqual([
			'# backlog 1',
			'a-other',
			'# todo 2',
			'b-later',
			'b-first'
		]);
	});

	it('returns nothing for nothing', () => {
		expect(sectionByStatus([])).toEqual([]);
	});
});
