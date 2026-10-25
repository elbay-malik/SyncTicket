// The decision half of "show me when someone else edits": which transactions count, what
// kind of change each was, and how it is said. Pure, so it runs in Node; the store test
// (remote-activity.svelte.test.ts) proves the same rules hold against a real Y.Doc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Issue } from '$lib/model/issue.js';
import {
	AnnouncementQueue,
	classifyChange,
	describeChange,
	isLiveRemote,
	summarise,
	type RemoteAuthor,
	type RemoteChange
} from './remote-change.js';

const issue = (patch: Partial<Issue> = {}): Issue => ({
	id: 'i1',
	title: 'Fix login redirect',
	description: '',
	status: 'todo',
	priority: 'none',
	assignee: null,
	labels: [],
	order: 'a0',
	createdAt: 1,
	updatedAt: 1,
	...patch
});

const ada: RemoteAuthor = { userId: `u${'a'.repeat(32)}`, name: 'Ada Lovelace', hue: 210 };
const grace: RemoteAuthor = { userId: `u${'b'.repeat(32)}`, name: 'Grace Hopper', hue: 12 };

const change = (patch: Partial<RemoteChange> = {}): RemoteChange => ({
	issueId: 'i1',
	kind: 'status',
	title: 'Fix login redirect',
	status: 'done',
	author: ada,
	at: 0,
	...patch
});

describe('classifyChange', () => {
	it('names creation, deletion and a status move', () => {
		expect(classifyChange(undefined, issue())).toBe('created');
		expect(classifyChange(issue(), undefined)).toBe('deleted');
		expect(classifyChange(issue(), issue({ status: 'done' }))).toBe('status');
	});

	it('ranks a status change above any other field changed with it', () => {
		expect(classifyChange(issue(), issue({ status: 'done', title: 'Renamed' }))).toBe('status');
	});

	it('calls any field a person edits an edit, labels included', () => {
		expect(classifyChange(issue(), issue({ title: 'Renamed' }))).toBe('edited');
		expect(classifyChange(issue(), issue({ description: 'More' }))).toBe('edited');
		expect(classifyChange(issue(), issue({ priority: 'high' }))).toBe('edited');
		expect(classifyChange(issue(), issue({ assignee: 'ada' }))).toBe('edited');
		expect(classifyChange(issue(), issue({ labels: ['bug'] }))).toBe('edited');
	});

	it('ignores bookkeeping a board drop writes onto cards nobody touched', () => {
		// planRepairs rewrites neighbours' order keys in the moving card's transaction.
		expect(classifyChange(issue(), issue({ order: 'a1', updatedAt: 2 }))).toBeNull();
		expect(classifyChange(undefined, undefined)).toBeNull();
	});
});

describe('isLiveRemote', () => {
	const live = { local: false, fromRelay: true, relaySynced: true, loaded: true };

	it('accepts a peer edit applied by the relay once both sides are in step', () => {
		expect(isLiveRemote(live)).toBe(true);
	});

	it('rejects this browser’s own edits, and undo/redo of them', () => {
		expect(isLiveRemote({ ...live, local: true })).toBe(false);
	});

	it('rejects IndexedDB hydrating this browser’s own copy', () => {
		expect(isLiveRemote({ ...live, fromRelay: false })).toBe(false);
	});

	it('rejects the relay’s catch-up, which lands before `synced` flips', () => {
		// A visitor opening a share link receives the whole workspace exactly this way, and
		// must not see every row light up.
		expect(isLiveRemote({ ...live, relaySynced: false })).toBe(false);
		expect(isLiveRemote({ ...live, loaded: false })).toBe(false);
	});
});

describe('describeChange', () => {
	it('says who did what to which issue', () => {
		expect(describeChange(change())).toBe('Ada Lovelace moved “Fix login redirect” to Done');
		expect(describeChange(change({ kind: 'created', status: 'todo' }))).toBe(
			'Ada Lovelace added “Fix login redirect”'
		);
		expect(describeChange(change({ kind: 'edited' }))).toBe(
			'Ada Lovelace edited “Fix login redirect”'
		);
	});

	it('says "Someone" rather than guessing an author it cannot resolve', () => {
		expect(describeChange(change({ kind: 'deleted', author: null }))).toBe(
			'Someone deleted “Fix login redirect”'
		);
	});

	it('cuts a long title for speech', () => {
		const text = describeChange(change({ title: 'x'.repeat(200) }));
		expect(text).toContain(`“${'x'.repeat(59)}…”`);
	});
});

describe('summarise', () => {
	it('keeps the full sentence for a single change', () => {
		expect(summarise([change()])).toBe('Ada Lovelace moved “Fix login redirect” to Done');
	});

	it('counts a burst by one person', () => {
		const burst = ['a', 'b', 'c'].map((id) => change({ issueId: id }));
		expect(summarise(burst)).toBe('Ada Lovelace changed 3 issues');
	});

	it('names everyone in a burst from several people', () => {
		const burst = [change({ issueId: 'a' }), change({ issueId: 'b', author: grace })];
		expect(summarise(burst)).toBe('2 issues changed by Ada Lovelace and Grace Hopper');
	});

	it('collapses several changes to one issue into that issue', () => {
		const burst = [change({ kind: 'edited' }), change({ kind: 'status' })];
		expect(summarise(burst)).toBe('Ada Lovelace changed “Fix login redirect”');
	});
});

describe('AnnouncementQueue', () => {
	let said: string[];
	let queue: AnnouncementQueue;

	beforeEach(() => {
		vi.useFakeTimers();
		said = [];
		queue = new AnnouncementQueue((message) => said.push(message), {
			settleMs: 500,
			gapMs: 2000,
			quietMs: 1000,
			repeatMs: 10_000
		});
	});

	afterEach(() => {
		queue.destroy();
		vi.useRealTimers();
	});

	it('waits for a burst to settle and says it once', () => {
		queue.push(change({ issueId: 'a' }));
		queue.push(change({ issueId: 'b' }));
		vi.advanceTimersByTime(499);
		expect(said).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(said).toEqual(['Ada Lovelace changed 2 issues']);
	});

	it('never speaks twice inside the gap', () => {
		queue.push(change({ issueId: 'a' }));
		vi.advanceTimersByTime(500);
		queue.push(change({ issueId: 'b', kind: 'created' }));
		vi.advanceTimersByTime(1999);
		expect(said).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(said).toEqual([
			'Ada Lovelace moved “Fix login redirect” to Done',
			'Ada Lovelace added “Fix login redirect”'
		]);
	});

	it('says a peer’s typing once, with the title they ended on, not the first pause', () => {
		// Idle commits 400ms apart, each a remote edit carrying the title so far.
		for (const title of ['F', 'Fix lo', 'Fix login']) {
			queue.push(change({ kind: 'edited', title }));
			vi.advanceTimersByTime(400);
		}
		expect(said).toEqual([]);
		vi.advanceTimersByTime(5000);
		expect(said).toEqual(['Ada Lovelace edited “Fix login”']);
	});

	it('says the title a peer’s Escape put back, rather than the one it took away', () => {
		queue.push(change({ kind: 'edited', title: 'First alpha' }));
		vi.advanceTimersByTime(700);
		queue.push(change({ kind: 'edited', title: 'First alpha beta' }));
		vi.advanceTimersByTime(700);
		queue.push(change({ kind: 'edited', title: 'First' }));
		vi.advanceTimersByTime(5000);
		expect(said).toEqual(['Ada Lovelace edited “First”']);
	});

	it('holds a run of edits to once per repeat window, and always says where it ended', () => {
		// A commit every 3s never leaves the issue quiet for long, but each 3s pause is past
		// `quietMs`: the first is said, the rest wait out the repeat window, and the last one
		// pushed is the one said when it ends.
		for (let i = 0; i < 5; i += 1) {
			queue.push(change({ kind: 'edited', title: `Draft ${i}` }));
			vi.advanceTimersByTime(3000);
		}
		expect(said).toEqual(['Ada Lovelace edited “Draft 0”', 'Ada Lovelace edited “Draft 3”']);
		vi.advanceTimersByTime(20_000);
		expect(said).toEqual([
			'Ada Lovelace edited “Draft 0”',
			'Ada Lovelace edited “Draft 3”',
			'Ada Lovelace edited “Draft 4”'
		]);
	});

	it('still speaks about someone typing without a pause, once per repeat window', () => {
		for (let t = 0; t < 12_000; t += 400) {
			queue.push(change({ kind: 'edited', title: `At ${t}` }));
			vi.advanceTimersByTime(400);
		}
		expect(said).toHaveLength(1);
	});

	it('does not hold back a status change behind an edit to the same issue', () => {
		queue.push(change({ kind: 'edited' }));
		vi.advanceTimersByTime(3000);
		queue.push(change({ kind: 'status' }));
		vi.advanceTimersByTime(3000);
		expect(said).toHaveLength(2);
	});

	it('says nothing after it is destroyed', () => {
		queue.push(change());
		queue.destroy();
		vi.advanceTimersByTime(5000);
		expect(said).toEqual([]);
	});
});
