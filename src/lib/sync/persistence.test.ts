// Phase 2 acceptance test: an issue created offline survives a hard reload.
// fake-indexeddb gives a real IndexedDB implementation in Node; a second doc opened
// against the same database name reloads the persisted state, standing in for a reload.

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { IndexeddbPersistence } from 'y-indexeddb';
import { workspaceDbName } from '$lib/model/workspace.js';
import { createDoc, getIssuesMap } from './doc.js';
import { createIssue, readAllIssues } from './issues.js';

const opened: IndexeddbPersistence[] = [];

function open(name: string) {
	const doc = createDoc();
	const provider = new IndexeddbPersistence(name, doc);
	opened.push(provider);
	return { doc, provider };
}

afterEach(async () => {
	while (opened.length) await opened.pop()?.clearData();
});

describe('IndexedDB persistence', () => {
	it('reloads an issue written in a previous session', async () => {
		const name = workspaceDbName(`persist-${crypto.randomUUID()}`);

		// Session 1: write an issue, then tear the doc down (simulating closing the tab).
		const first = open(name);
		await first.provider.whenSynced;
		const id = createIssue(getIssuesMap(first.doc), { title: 'Offline issue' });
		await new Promise((resolve) => setTimeout(resolve, 50)); // let the write flush to IndexedDB
		await first.provider.destroy();
		first.doc.destroy();

		// Session 2: reopen the same database — the issue must be there.
		const second = open(name);
		await second.provider.whenSynced;
		const issues = readAllIssues(getIssuesMap(second.doc));
		expect(issues).toHaveLength(1);
		expect(issues[0]?.id).toBe(id);
		expect(issues[0]?.title).toBe('Offline issue');
	});

	it('keeps workspaces isolated by id', async () => {
		const nameA = workspaceDbName(`ws-a-${crypto.randomUUID()}`);
		const nameB = workspaceDbName(`ws-b-${crypto.randomUUID()}`);
		expect(nameA).not.toBe(nameB);

		const a = open(nameA);
		const b = open(nameB);
		await Promise.all([a.provider.whenSynced, b.provider.whenSynced]);
		createIssue(getIssuesMap(a.doc), { title: 'only in A' });
		await new Promise((resolve) => setTimeout(resolve, 50));

		// Workspace B, a different database, must not see A's issue.
		expect(readAllIssues(getIssuesMap(b.doc))).toHaveLength(0);

		// Reopening A's database still has it; reopening B's is still empty.
		await a.provider.destroy();
		const aAgain = open(nameA);
		await aAgain.provider.whenSynced;
		expect(readAllIssues(getIssuesMap(aAgain.doc))).toHaveLength(1);
	});
});
