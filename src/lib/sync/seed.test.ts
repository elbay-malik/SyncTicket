import { describe, expect, it } from 'vitest';
import { ISSUE_STATUSES } from '$lib/model/issue.js';
import { createDoc, getIssuesMap } from './doc.js';
import { createIssue, readAllIssues } from './issues.js';
import { seedDemoIssues, seedIssues } from './seed.js';

describe('seedIssues', () => {
	it('creates the requested number of well-formed issues', () => {
		const map = getIssuesMap(createDoc());
		const ids = seedIssues(map, 200, { seed: 7 });
		expect(ids).toHaveLength(200);

		const issues = readAllIssues(map);
		expect(issues).toHaveLength(200);
		for (const issue of issues) {
			expect(issue.title).not.toBe('');
			expect(ISSUE_STATUSES).toContain(issue.status);
			expect(issue.order).not.toBe('');
		}
	});

	it('assigns strictly increasing, unique order keys', () => {
		const map = getIssuesMap(createDoc());
		seedIssues(map, 500, { seed: 3 });
		const orders = readAllIssues(map).map((issue) => issue.order);
		expect(orders).toEqual([...orders].sort());
		expect(new Set(orders).size).toBe(orders.length);
	});

	it('appends after existing issues instead of interleaving', () => {
		const map = getIssuesMap(createDoc());
		const first = createIssue(map, { title: 'Existing' });
		const existingOrder = readAllIssues(map).find((i) => i.id === first)?.order ?? '';
		seedIssues(map, 50, { seed: 1 });
		const seeded = readAllIssues(map).filter((issue) => issue.id !== first);
		for (const issue of seeded) expect(issue.order > existingOrder).toBe(true);
	});

	it('is deterministic for a given seed', () => {
		const a = getIssuesMap(createDoc());
		const b = getIssuesMap(createDoc());
		seedIssues(a, 30, { seed: 42 });
		seedIssues(b, 30, { seed: 42 });
		const titles = (map: typeof a) =>
			readAllIssues(map)
				.map((i) => i.title)
				.sort();
		expect(titles(a)).toEqual(titles(b));
	});

	it('does nothing for a non-positive count', () => {
		const map = getIssuesMap(createDoc());
		expect(seedIssues(map, 0)).toEqual([]);
		expect(readAllIssues(map)).toHaveLength(0);
	});

	it('writes 10k issues in one transaction', () => {
		const doc = createDoc();
		const map = getIssuesMap(doc);
		let updates = 0;
		doc.on('update', () => (updates += 1));
		seedIssues(map, 10_000, { seed: 5 });
		expect(readAllIssues(map)).toHaveLength(10_000);
		expect(updates).toBe(1);
	});
});

describe('seedDemoIssues', () => {
	it('creates a small, well-formed, human-written backlog', () => {
		const map = getIssuesMap(createDoc());
		const ids = seedDemoIssues(map);
		// More than a couple, few enough that a first-time visitor can look at every one.
		expect(ids.length).toBeGreaterThan(8);
		expect(ids.length).toBeLessThan(30);

		const issues = readAllIssues(map);
		expect(issues).toHaveLength(ids.length);
		for (const issue of issues) {
			expect(issue.title.length).toBeGreaterThan(0);
			// Nothing that reads as generated filler — no "#3"-style benchmark suffix.
			expect(issue.title).not.toMatch(/#\d+$/);
			expect(ISSUE_STATUSES).toContain(issue.status);
			expect(issue.order).not.toBe('');
		}
	});

	it('spans every status, so the board looks populated rather than lopsided', () => {
		const map = getIssuesMap(createDoc());
		seedDemoIssues(map);
		const statuses = new Set(readAllIssues(map).map((issue) => issue.status));
		for (const status of ISSUE_STATUSES) expect(statuses.has(status)).toBe(true);
	});

	it('assigns strictly increasing, unique order keys', () => {
		const map = getIssuesMap(createDoc());
		seedDemoIssues(map);
		const orders = readAllIssues(map).map((issue) => issue.order);
		expect(orders).toEqual([...orders].sort());
		expect(new Set(orders).size).toBe(orders.length);
	});

	it('appends after existing issues instead of interleaving', () => {
		const map = getIssuesMap(createDoc());
		const first = createIssue(map, { title: 'Existing' });
		const existingOrder = readAllIssues(map).find((i) => i.id === first)?.order ?? '';
		seedDemoIssues(map);
		const seeded = readAllIssues(map).filter((issue) => issue.id !== first);
		for (const issue of seeded) expect(issue.order > existingOrder).toBe(true);
	});

	it('writes everything in one transaction', () => {
		const doc = createDoc();
		const map = getIssuesMap(doc);
		let updates = 0;
		doc.on('update', () => (updates += 1));
		seedDemoIssues(map);
		expect(updates).toBe(1);
	});
});
