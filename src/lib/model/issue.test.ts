import { describe, expect, it } from 'vitest';
import {
	ISSUE_PRIORITIES,
	ISSUE_STATUSES,
	PRIORITY_META,
	PRIORITY_RANK,
	STATUS_META,
	isIssueId,
	isIssuePriority,
	isIssueStatus,
	issueIdParam
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

describe('isIssueId', () => {
	const uuid = '0f1e2d3c-4b5a-4978-8a6b-5c4d3e2f1a0b';

	it('accepts what crypto.randomUUID() mints', () => {
		for (let i = 0; i < 1000; i += 1) expect(isIssueId(crypto.randomUUID())).toBe(true);
		expect(isIssueId(uuid)).toBe(true);
	});

	it.each([
		['nothing', ''],
		['a word', 'corrupt'],
		['the audit exploit', '../issues?ws=wdeadbeefdeadbeefdeadbeefdeadbeef'],
		['a leading slash', '/x'],
		['a trailing slash', 'x/'],
		['dashes alone, which /^[0-9a-f-]{36}$/ would accept', '-'.repeat(36)],
		['36 hex digits', 'a'.repeat(36)],
		['no dashes', uuid.replaceAll('-', '')],
		['uppercase', uuid.toUpperCase()],
		['one uppercase digit', uuid.replace('f', 'F')],
		['a group too short', uuid.slice(1)],
		['a group too long', `${uuid}0`],
		['dashes in the wrong place', '0f1e2d3c4-b5a-4978-8a6b-5c4d3e2f1a0b'],
		['non-hex', uuid.replace('f', 'g')],
		['braces', `{${uuid}}`],
		['a trailing newline', `${uuid}\n`],
		['a leading newline', `\n${uuid}`],
		['a second line after it', `${uuid}\nx`],
		['a line before it', `x\n${uuid}`],
		['padding', ` ${uuid} `],
		['full-width digits', uuid.replace('0', '\uFF10')]
	])('rejects %s', (_, id) => {
		expect(isIssueId(id)).toBe(false);
	});

	it('rejects anything but a string', () => {
		for (const value of [null, undefined, 42, {}, [uuid], new String(uuid)]) {
			expect(isIssueId(value)).toBe(false);
		}
	});
});

describe('issueIdParam', () => {
	it('leaves a real id exactly as it is', () => {
		const id = crypto.randomUUID();
		expect(issueIdParam(id)).toBe(id);
	});

	it('leaves nothing that could end the path segment, and decodes back to the same id', () => {
		for (const id of ['../issues?ws=w0', '/x', 'x/', 'a#b', 'a b', '\0']) {
			const param = issueIdParam(id);
			expect(param).not.toMatch(/[/?#\s\0]/);
			expect(decodeURIComponent(param)).toBe(id);
		}
	});
});
