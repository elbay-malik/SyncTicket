// What a peer can store as an issue's `createdAt` or `updatedAt`, delivered from another replica.
// Any finite number used to read as a time, and past what a Date can hold `toISOString` throws
// while the editor renders, for everyone who opens that issue, with no edit able to clear it.
// The editor's half is in components/issues/bad-timestamps.svelte.test.ts.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { isoTime } from '$lib/format.js';
import { createDoc, getIssuesMap } from './doc.js';
import { patchIssue, readAllIssues, readIssue } from './issues.js';
import { REAL_ID, peerWrites, wellFormedIssue } from './junk-entries.fixture.js';

/** The last time a Date can hold, either side of the epoch. */
const LIMIT = 8.64e15;

const OUT_OF_RANGE = [LIMIT + 1, 8.65e15, 1e300, Number.MAX_VALUE, -LIMIT - 1, -8.65e15, -1e308];
const NOT_NUMBERS = [Number.NaN, Infinity, -Infinity, '1', null, true, [1], { at: 1 }];

function deliver(fields: Record<string, unknown>) {
	const doc = createDoc();
	const map = getIssuesMap(doc);
	peerWrites(doc, (issues) => issues.set(REAL_ID, wellFormedIssue({ updatedAt: 200, ...fields })));
	return { map, read: () => readIssue(REAL_ID, map.get(REAL_ID) as Y.Map<unknown>) };
}

describe.each([...OUT_OF_RANGE, ...NOT_NUMBERS])('a stored time of %s', (value) => {
	it('reads as no creation time', () => {
		expect(deliver({ createdAt: value }).read().createdAt).toBe(0);
	});

	it('reads as last updated when it was created', () => {
		const { read } = deliver({ createdAt: 100, updatedAt: value });
		expect(read().updatedAt).toBe(100);
	});

	it('falls all the way back when both fields hold it', () => {
		const issue = deliver({ createdAt: value, updatedAt: value }).read();
		expect(issue.createdAt).toBe(0);
		expect(issue.updatedAt).toBe(0);
	});

	it('leaves nothing the editor could choke on', () => {
		const issue = deliver({ createdAt: value, updatedAt: value }).read();
		expect(() => [isoTime(issue.createdAt), isoTime(issue.updatedAt)]).not.toThrow();
	});
});

describe('the times a Date can hold', () => {
	it.each([LIMIT, -LIMIT, 1, -1, 0, 1.5, Date.UTC(2026, 10, 1)])('keeps %s', (value) => {
		const issue = deliver({ createdAt: value, updatedAt: value }).read();
		expect(issue.createdAt).toBe(value);
		expect(issue.updatedAt).toBe(value);
		expect(() => isoTime(issue.createdAt)).not.toThrow();
	});
});

describe('a bad time and the rest of the document', () => {
	it('is not repaired by reading it, because a read never writes', () => {
		const { map, read } = deliver({ createdAt: 1e300 });
		read();
		expect((map.get(REAL_ID) as Y.Map<unknown>).get('createdAt')).toBe(1e300);
	});

	it('reads the same through readAllIssues, which is what the store projects', () => {
		const { map } = deliver({ createdAt: 1e300, updatedAt: 1e300 });
		expect(readAllIssues(map)[0]).toMatchObject({ createdAt: 0, updatedAt: 0 });
	});

	it('gives way to the next edit in updatedAt, and leaves createdAt alone', () => {
		const { map, read } = deliver({ createdAt: 1e300, updatedAt: 1e300 });
		const before = Date.now();

		patchIssue(map, REAL_ID, { title: 'Edited' });

		expect(read().title).toBe('Edited');
		expect(read().updatedAt).toBeGreaterThanOrEqual(before);
		expect(read().createdAt).toBe(0);
	});
});
