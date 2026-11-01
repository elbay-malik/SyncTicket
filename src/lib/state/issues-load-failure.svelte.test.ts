// The last line of defence: whatever goes wrong in the post-load rebuild, the visitor must not
// be left on the skeleton. Nothing a peer can write reaches this any more, so the read itself
// is made to fail, which needs a module of its own for the mock.

import { afterEach, expect, it, vi } from 'vitest';
import { IssueStore } from './issues.svelte.js';

const reads = vi.hoisted(() => ({ fail: false }));

vi.mock('$lib/sync/issues.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sync/issues.js')>();
	const guarded =
		<A extends unknown[], R>(read: (...args: A) => R) =>
		(...args: A): R => {
			if (reads.fail) throw new Error('read failed');
			return read(...args);
		};
	return {
		...actual,
		readIssue: guarded(actual.readIssue),
		readAllIssues: guarded(actual.readAllIssues)
	};
});

afterEach(() => {
	reads.fail = false;
	vi.restoreAllMocks();
});

it('finishes loading and logs the failure when the post-load rebuild throws', async () => {
	const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
	const store = new IssueStore(`test-${crypto.randomUUID()}`);
	store.create({ title: 'In the document' });
	reads.fail = true;

	await vi.waitFor(() => expect(store.synced).toBe(true));

	expect(logged).toHaveBeenCalled();
	store.destroy();
});
