// The store against entries under `issues` that are not issues, delivered the way a peer
// delivers them: values that are not issue maps, and issue maps under keys that are not ids. A
// store that survives one of these has to do so at load and live: the load is what used to hang
// every visitor on the skeleton, and the live path is what used to lose the rest of the batch.
// The reads in sync/ are covered by sync/junk-entries.test.ts and sync/bad-issue-ids.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createIdentity } from '$lib/model/identity.js';
import { createDoc, getIssuesMap } from '$lib/sync/doc.js';
import { createIssue, readAllIssues } from '$lib/sync/issues.js';
import {
	BAD_IDS,
	JUNK_ID,
	JUNK_VALUES,
	REAL_ID,
	SLOT_ID,
	peerWrites,
	wellFormedIssue
} from '$lib/sync/junk-entries.fixture.js';
import { attachPersistence } from '$lib/sync/persistence.js';
import { IssueStore, type IssueDelta } from './issues.svelte.js';
import type { RemoteChange } from './remote-change.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length) cleanups.pop()?.();
	vi.restoreAllMocks();
});

/** A loaded store on a relay this test drives, as in remote-activity.svelte.test.ts. */
async function makeHarness() {
	const provider = { fake: 'relay provider' };
	let doc: Y.Doc | null = null;
	let onSynced: (synced: boolean) => void = () => {};
	const store = new IssueStore(`test-${crypto.randomUUID()}`, {
		attachRelay: (attached, _workspaceId, handlers) => {
			doc = attached;
			onSynced = handlers.onSynced;
			const awareness = new Awareness(attached);
			clearInterval(awareness._checkInterval);
			return { provider: provider as never, awareness, destroy: () => awareness.destroy() };
		}
	});
	cleanups.push(() => store.destroy());
	await vi.waitFor(() => expect(store.synced).toBe(true));
	onSynced(true);
	const changes: RemoteChange[] = [];
	cleanups.push(store.remote.subscribe((change) => changes.push(change)));
	const deltas: IssueDelta[] = [];
	cleanups.push(store.onChange((delta) => deltas.push(delta)));
	const target = doc as unknown as Y.Doc;
	return {
		store,
		doc: target,
		changes,
		deltas,
		peer: (write: (issues: Y.Map<unknown>) => void) => peerWrites(target, write, provider),
		/** The projection has not drifted from what the document holds. */
		expectInStep() {
			const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1);
			expect([...store.all].sort(byId)).toEqual(readAllIssues(getIssuesMap(target)).sort(byId));
		}
	};
}

describe.each(JUNK_VALUES)('$name under issues', ({ make }) => {
	it('does not stop a later load, nor hide the issues beside it', async () => {
		const workspaceId = `test-${crypto.randomUUID()}`;
		const earlier = createDoc();
		const persistence = attachPersistence(earlier, workspaceId);
		await persistence.whenSynced;
		createIssue(getIssuesMap(earlier), { title: 'Kept' });
		peerWrites(earlier, (issues) => issues.set(JUNK_ID, make()));
		await persistence.destroy();
		earlier.destroy();

		const store = new IssueStore(workspaceId);
		cleanups.push(() => store.destroy());
		const resets: IssueDelta[] = [];
		store.onChange((delta) => {
			if (delta.reset) resets.push(delta);
		});
		await vi.waitFor(() => expect(store.synced).toBe(true));

		expect(store.persisted).toBe(true);
		expect(store.all.map((issue) => issue.title)).toEqual(['Kept']);
		expect(resets.at(-1)?.upserted.map((issue) => issue.title)).toEqual(['Kept']);
		expect(store.get(JUNK_ID)).toBeUndefined();
		store.create({ title: 'Next' });
		expect(store.all).toHaveLength(2);
	});

	it('does not cost the other issues in the batch that delivered it', async () => {
		const { store, deltas, changes, peer, expectInStep } = await makeHarness();
		peer((issues) => {
			issues.set(JUNK_ID, make());
			issues.set(REAL_ID, new Y.Map([['title', 'Real']]));
		});

		expect(store.all.map((issue) => issue.title)).toEqual(['Real']);
		expect(deltas.map((delta) => delta.upserted.map((issue) => issue.id))).toEqual([[REAL_ID]]);
		expect(deltas[0]?.removed).toEqual([]);
		expect(changes.map((change) => [change.issueId, change.kind])).toEqual([[REAL_ID, 'created']]);
		expectInStep();
	});

	it('takes the row with it when it replaces an issue', async () => {
		const { store, doc, deltas, changes, peer, expectInStep } = await makeHarness();
		const id = createIssue(getIssuesMap(doc), { title: 'Replaced' });
		deltas.length = 0;
		peer((issues) => issues.set(id, make()));

		expect(store.get(id)).toBeUndefined();
		expect(deltas).toEqual([{ upserted: [], removed: [id], reset: false }]);
		// To everyone else this is a deletion, and the row it would be traced on is gone.
		expect(changes).toEqual([
			expect.objectContaining({ issueId: id, kind: 'deleted', title: 'Replaced', author: null })
		]);
		expectInStep();
	});

	it('gives way to a real issue written over it', async () => {
		const { store, deltas, changes, peer, expectInStep } = await makeHarness();
		peer((issues) => issues.set(SLOT_ID, make()));
		expect(deltas).toEqual([]);

		peer((issues) => issues.set(SLOT_ID, new Y.Map([['title', 'Recovered']])));

		expect(store.get(SLOT_ID)?.title).toBe('Recovered');
		expect(deltas).toEqual([
			{ upserted: [expect.objectContaining({ id: SLOT_ID })], removed: [], reset: false }
		]);
		expect(changes).toEqual([expect.objectContaining({ issueId: SLOT_ID, kind: 'created' })]);
		expectInStep();
	});

	it('is silent when it is deleted or overwritten by more junk', async () => {
		const { deltas, changes, peer, expectInStep } = await makeHarness();
		peer((issues) => issues.set(JUNK_ID, make()));
		peer((issues) => issues.set(JUNK_ID, make()));
		peer((issues) => issues.delete(JUNK_ID));

		expect(deltas).toEqual([]);
		expect(changes).toEqual([]);
		expectInStep();
	});

	it('cannot be edited, moved or removed through the store', async () => {
		const { store, doc, deltas, peer } = await makeHarness();
		peer((issues) => issues.set(JUNK_ID, make()));

		store.update(JUNK_ID, { title: 'Renamed' });
		store.move(JUNK_ID, 'done', [JUNK_ID]);
		store.remove(JUNK_ID);

		expect(getIssuesMap(doc).has(JUNK_ID)).toBe(true);
		expect(deltas).toEqual([]);
		expect(store.canUndo).toBe(false);
	});

	it('survives undo and redo of the issue it replaced', async () => {
		const { store, peer, expectInStep } = await makeHarness();
		const created = store.create({ title: 'Created' });
		peer((issues) => issues.set(created, make()));
		expect(() => store.undo()).not.toThrow();
		expectInStep();
		expect(() => store.redo()).not.toThrow();
		expectInStep();
	});

	it('survives undo and redo of an edit to the issue it replaced', async () => {
		const { store, doc, peer, expectInStep } = await makeHarness();
		const id = createIssue(getIssuesMap(doc), { title: 'Edited' });
		store.update(id, { title: 'Edited again' });
		peer((issues) => issues.set(id, make()));
		expect(() => store.undo()).not.toThrow();
		expectInStep();
		expect(() => store.redo()).not.toThrow();
		expectInStep();
	});

	it('survives undo and redo of a delete it landed on top of', async () => {
		const { store, doc, peer, expectInStep } = await makeHarness();
		const id = createIssue(getIssuesMap(doc), { title: 'Deleted' });
		store.remove(id);
		peer((issues) => issues.set(id, make()));
		expect(() => store.undo()).not.toThrow();
		expectInStep();
		expect(() => store.redo()).not.toThrow();
		expectInStep();
	});
});

describe('edits inside a junk entry', () => {
	const nested: ReadonlyArray<{
		name: string;
		make: () => unknown;
		edit: (entry: never) => void;
	}> = [
		{
			name: 'a Y.Text being typed into',
			make: () => new Y.Text('boom'),
			edit: (entry: Y.Text) => entry.insert(0, 'more ')
		},
		{
			name: 'a Y.Array being pushed to',
			make: () => Y.Array.from(['boom']),
			edit: (entry: Y.Array<string>) => entry.push(['more'])
		},
		{
			// path is [JUNK_ID, 0], so the depth of the path is not what makes this safe.
			name: 'a Y.Map inside a Y.Array',
			make: () => Y.Array.from([new Y.Map([['title', 'Deep']])]),
			edit: (entry: Y.Array<Y.Map<string>>) => entry.get(0).set('title', 'Deeper')
		},
		{
			name: 'a Y.XmlFragment gaining a child',
			make: () => new Y.XmlFragment(),
			edit: (entry: Y.XmlFragment) => entry.push([new Y.XmlElement('p')])
		}
	];

	it.each(nested)('$name reaches nobody', async ({ make, edit }) => {
		const { store, deltas, changes, peer, expectInStep } = await makeHarness();
		peer((issues) => issues.set(JUNK_ID, make()));

		peer((issues) => edit(issues.get(JUNK_ID) as never));

		expect(store.get(JUNK_ID)).toBeUndefined();
		expect(deltas).toEqual([]);
		expect(changes).toEqual([]);
		expectInStep();
	});

	it('does not cost a real edit in the same batch', async () => {
		const { store, doc, deltas, changes, peer } = await makeHarness();
		const id = createIssue(getIssuesMap(doc), { title: 'Before' });
		peer((issues) => issues.set(JUNK_ID, new Y.Text('boom')));
		deltas.length = 0;

		peer((issues) => {
			(issues.get(JUNK_ID) as Y.Text).insert(0, 'more ');
			(issues.get(id) as Y.Map<unknown>).set('title', 'After');
		});

		expect(store.get(id)?.title).toBe('After');
		expect(deltas.flatMap((delta) => delta.upserted.map((issue) => issue.id))).toEqual([id]);
		expect(changes).toEqual([expect.objectContaining({ issueId: id, kind: 'edited' })]);
	});

	it('still names the author of a real issue that follows junk at the same key', async () => {
		const { store, changes, peer } = await makeHarness();
		peer((issues) => issues.set(SLOT_ID, 'boom'));

		peer((issues) => {
			const replica = issues.doc as Y.Doc;
			const awareness = new Awareness(replica);
			clearInterval(awareness._checkInterval);
			awareness.setLocalState({ ...createIdentity(), name: 'Ada', issue: null, t: Date.now() });
			applyAwarenessUpdate(
				store.awareness,
				encodeAwarenessUpdate(awareness, [replica.clientID]),
				'remote'
			);
			awareness.destroy();
			issues.set(SLOT_ID, new Y.Map([['title', 'Recovered']]));
		});

		expect(changes.at(-1)?.author?.name).toBe('Ada');
	});
});

describe('a listener that throws', () => {
	it('does not leave the store loading, and is logged', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const store = new IssueStore(`test-${crypto.randomUUID()}`);
		cleanups.push(() => store.destroy());
		const heard: boolean[] = [];
		store.onChange(() => {
			throw new Error('listener failed');
		});
		store.onChange((delta) => heard.push(delta.reset));

		await vi.waitFor(() => expect(store.synced).toBe(true));

		expect(store.persisted).toBe(true);
		expect(heard).toEqual([true]);
		expect(logged).toHaveBeenCalled();
	});

	it('does not cost the other listeners or the live changes of that batch', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { store, changes, peer } = await makeHarness();
		store.onChange(() => {
			throw new Error('listener failed');
		});
		const heard: string[] = [];
		store.onChange((delta) => heard.push(...delta.upserted.map((issue) => issue.id)));

		expect(() => peer((issues) => issues.set(REAL_ID, new Y.Map()))).not.toThrow();

		expect(heard).toEqual([REAL_ID]);
		expect(changes).toEqual([expect.objectContaining({ issueId: REAL_ID, kind: 'created' })]);
		expect(logged).toHaveBeenCalled();
	});
});

describe.each(BAD_IDS.map((id) => ({ id })))('an issue under the key $id', ({ id }) => {
	it('has no row after a load, and does not hide the issues beside it', async () => {
		const workspaceId = `test-${crypto.randomUUID()}`;
		const earlier = createDoc();
		const persistence = attachPersistence(earlier, workspaceId);
		await persistence.whenSynced;
		createIssue(getIssuesMap(earlier), { title: 'Kept' });
		peerWrites(earlier, (issues) => issues.set(id, wellFormedIssue()));
		await persistence.destroy();
		earlier.destroy();

		const store = new IssueStore(workspaceId);
		cleanups.push(() => store.destroy());
		const resets: IssueDelta[] = [];
		store.onChange((delta) => {
			if (delta.reset) resets.push(delta);
		});
		await vi.waitFor(() => expect(store.synced).toBe(true));

		expect(store.all.map((issue) => issue.title)).toEqual(['Kept']);
		expect(resets.at(-1)?.upserted.map((issue) => issue.title)).toEqual(['Kept']);
		expect(store.get(id)).toBeUndefined();
	});

	it('has no row when it arrives live, beside a real issue in the same batch', async () => {
		const { store, deltas, changes, peer, expectInStep } = await makeHarness();
		peer((issues) => {
			issues.set(id, wellFormedIssue());
			issues.set(REAL_ID, wellFormedIssue({ title: 'Real' }));
		});

		expect(store.get(id)).toBeUndefined();
		expect(store.all.map((issue) => issue.title)).toEqual(['Real']);
		expect(deltas.flatMap((delta) => delta.upserted.map((issue) => issue.id))).toEqual([REAL_ID]);
		expect(changes.map((change) => change.issueId)).toEqual([REAL_ID]);
		expectInStep();
	});

	it('is not brought back by an edit inside it', async () => {
		const { store, deltas, changes, peer, expectInStep } = await makeHarness();
		peer((issues) => issues.set(id, wellFormedIssue()));

		peer((issues) => (issues.get(id) as Y.Map<unknown>).set('title', 'Fix login now'));

		expect(store.get(id)).toBeUndefined();
		expect(store.all).toEqual([]);
		expect(deltas).toEqual([]);
		expect(changes).toEqual([]);
		expectInStep();
	});

	it('is silent when it is overwritten or deleted', async () => {
		const { deltas, changes, peer, expectInStep } = await makeHarness();
		peer((issues) => issues.set(id, wellFormedIssue()));
		peer((issues) => issues.set(id, wellFormedIssue({ title: 'Again' })));
		peer((issues) => issues.delete(id));

		expect(deltas).toEqual([]);
		expect(changes).toEqual([]);
		expectInStep();
	});

	it('cannot be edited, moved or removed through the store', async () => {
		const { store, doc, deltas, peer } = await makeHarness();
		peer((issues) => issues.set(id, wellFormedIssue()));

		store.update(id, { title: 'Renamed' });
		store.move(id, 'done', [id]);
		store.remove(id);

		expect((getIssuesMap(doc).get(id) as Y.Map<unknown>).get('title')).toBe('Fix login');
		expect(deltas).toEqual([]);
		expect(store.canUndo).toBe(false);
	});
});
