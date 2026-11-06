// A peer's change landing in a field you have focused.
//
// Two things went wrong here in the demo test. With nothing typed yet, a peer's value replaced
// the text and the browser moved the selection to the end, so someone who had selected the title
// to type over it produced "Alice's editBob's edit". And once an idle commit had stored your
// text, the field kept showing it over a peer's newer value, and leaving the field wrote it back
// without a keystroke. Everything here arrives as a real update from a separate document.

import { flushSync, tick } from 'svelte';
import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { getIssuesMap } from '$lib/sync/doc.js';
import type { IssuePatch } from '$lib/model/issue.js';
import { patchIssue } from '$lib/sync/issues.js';
import { IssueStore } from '$lib/state/issues.svelte.js';
import IssueDetailSheet from './issue-detail-sheet.svelte';
import { IDLE_COMMIT_MS } from './issue-editor.svelte';

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length) cleanups.pop()?.();
});

const idle = () => new Promise((resolve) => setTimeout(resolve, IDLE_COMMIT_MS + 150));

async function setup(fields: {
	title: string;
	description?: string;
	assignee?: string;
	labels?: string[];
}) {
	const provider = { fake: 'relay provider' };
	let attached = null as Y.Doc | null;
	const store = new IssueStore(`editor-peer-${crypto.randomUUID()}`, {
		attachRelay: (doc) => {
			attached = doc;
			const awareness = new Awareness(doc);
			clearInterval(awareness._checkInterval);
			return { provider: provider as never, awareness, destroy: () => awareness.destroy() };
		}
	});
	cleanups.push(() => store.destroy());
	await vi.waitFor(() => expect(store.synced).toBe(true), { timeout: 4_000 });
	const doc = attached as unknown as Y.Doc;
	const id = store.create(fields);

	/** A peer who has seen everything so far changes the issue, and that reaches this store. */
	const peer = async (patch: IssuePatch) => {
		const other = new Y.Doc();
		Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
		const since = Y.encodeStateVector(doc);
		patchIssue(getIssuesMap(other), id, patch);
		Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, since), provider);
		other.destroy();
		flushSync();
		await tick();
	};

	/**
	 * A peer who has seen everything so far and then goes on without seeing anything more, so
	 * what they write later is concurrent with whatever this store writes meanwhile. `above`
	 * picks their client id relative to this store's, which is what Yjs settles a tie by.
	 */
	const concurrentPeer = (above: boolean) => {
		const other = new Y.Doc();
		other.clientID = doc.clientID + (above ? 1 : -1);
		Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
		const since = Y.encodeStateVector(other);
		return async (patch: IssuePatch) => {
			patchIssue(getIssuesMap(other), id, patch);
			Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, since), provider);
			other.destroy();
			flushSync();
			await tick();
		};
	};

	const onOpenChange = vi.fn();
	const view = await render(IssueDetailSheet, { store, id, open: true, onOpenChange });
	const dialog = page.getByRole('dialog');
	await expect.element(dialog.getByLabelText('Title')).toBeVisible();
	const field = (label: string) =>
		dialog.getByLabelText(label).element() as HTMLInputElement | HTMLTextAreaElement;
	return { store, id, peer, concurrentPeer, field, view };
}

const selection = (el: HTMLInputElement | HTMLTextAreaElement) => [
	el.selectionStart,
	el.selectionEnd
];

describe('a peer value landing in a focused field with nothing typed yet', () => {
	it('keeps the whole title selected, so typing replaces it rather than appending', async () => {
		const { store, id, peer, field } = await setup({ title: 'Original' });
		const title = field('Title');
		await userEvent.click(title);
		title.select();

		await peer({ title: "Alice's edit" });
		expect(title.value).toBe("Alice's edit");
		expect(selection(title)).toEqual([0, "Alice's edit".length]);

		await userEvent.keyboard("Bob's edit{Enter}");
		expect(store.get(id)?.title).toBe("Bob's edit");
	});

	it('keeps a caret where it was instead of jumping to the end', async () => {
		const { peer, field } = await setup({ title: 'Original' });
		const title = field('Title');
		await userEvent.click(title);
		title.setSelectionRange(2, 2);

		// The peer added to the end; the caret was in text that did not change.
		await peer({ title: 'Original, renamed' });
		expect(selection(title)).toEqual([2, 2]);
	});

	it('keeps a partial selection on the same words', async () => {
		const { peer, field } = await setup({ title: 'Original title' });
		const title = field('Title');
		await userEvent.click(title);
		title.setSelectionRange(9, 14); // "title"

		await peer({ title: '[P1] Original title' });
		expect(selection(title)).toEqual([14, 19]);
		expect(title.value.slice(14, 19)).toBe('title');
	});

	it('does the same for the description, assignee and labels', async () => {
		const { store, id, peer, field } = await setup({
			title: 'Has fields',
			description: 'Old body',
			assignee: 'alice',
			labels: ['old']
		});

		const description = field('Description');
		await userEvent.click(description);
		description.select();
		await peer({ description: 'New body from a peer' });
		expect(selection(description)).toEqual([0, 'New body from a peer'.length]);

		const assignee = field('Assignee');
		await userEvent.click(assignee);
		assignee.select();
		await peer({ assignee: 'carol' });
		expect(selection(assignee)).toEqual([0, 5]);
		await userEvent.keyboard('bob{Enter}');
		expect(store.get(id)?.assignee).toBe('bob');

		const labels = field('Labels');
		await userEvent.click(labels);
		labels.select();
		await peer({ labels: ['alpha'] });
		expect(selection(labels)).toEqual([0, 5]);
		await userEvent.keyboard('beta{Enter}');
		expect(store.get(id)?.labels).toEqual(['beta']);
	});

	it('keeps a caret at the end at the end when longer text arrives, so typing carries on', async () => {
		const { store, id, peer, field } = await setup({ title: 'Fix' });
		const title = field('Title');
		await userEvent.click(title);
		title.setSelectionRange(3, 3);

		await peer({ title: 'Fix the login bug' });
		expect(selection(title)).toEqual([17, 17]);
		await userEvent.keyboard('!{Enter}');
		expect(store.get(id)?.title).toBe('Fix the login bug!');
	});

	it('moves a caret along with text a peer put in front of it', async () => {
		const { peer, field } = await setup({ title: 'Fix login' });
		const title = field('Title');
		await userEvent.click(title);
		title.setSelectionRange(4, 4);

		await peer({ title: '[P1] Fix login' });
		expect(selection(title)).toEqual([9, 9]);
	});

	it('keeps a backward selection backward', async () => {
		const { peer, field } = await setup({ title: 'Original title' });
		const title = field('Title');
		await userEvent.click(title);
		title.setSelectionRange(2, 8, 'backward');

		await peer({ title: 'Original title, renamed' });
		expect(title.selectionDirection).toBe('backward');
	});

	it('keeps a caret in the description too', async () => {
		const { peer, field } = await setup({ title: 'Has a body', description: 'Old body text' });
		const description = field('Description');
		await userEvent.click(description);
		description.setSelectionRange(3, 3);

		await peer({ description: 'Old body text, and more' });
		expect(selection(description)).toEqual([3, 3]);
	});

	it('leaves the selection in another field alone', async () => {
		const { peer, field } = await setup({ title: 'Original', description: 'Some body' });
		const description = field('Description');
		await userEvent.click(description);
		description.setSelectionRange(2, 6);

		await peer({ title: 'Renamed' });
		expect(field('Title').value).toBe('Renamed');
		expect(document.activeElement).toBe(description);
		expect(selection(description)).toEqual([2, 6]);
	});
});

describe('a peer changing a field after your idle commit stored it', () => {
	it('shows the peer value while you are still in the field', async () => {
		const { store, id, peer, field } = await setup({ title: 'Original' });
		const title = field('Title');
		await userEvent.click(title);
		await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}Alice');
		await idle();
		expect(store.get(id)?.title).toBe('Alice');

		await peer({ title: 'Bob, later' });
		expect(title.value).toBe('Bob, later');
		expect(document.activeElement).toBe(title);
	});

	it('puts the caret at the end of the peer value when it was at the end of yours', async () => {
		const { store, id, peer, field } = await setup({ title: 'Original' });
		const title = field('Title');
		await userEvent.click(title);
		await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}Alice');
		await idle();
		await peer({ title: 'Bob, later on' });

		expect(selection(title)).toEqual([13, 13]);
		await userEvent.keyboard('!{Enter}');
		expect(store.get(id)?.title).toBe('Bob, later on!');
	});

	it('writes nothing when you then leave the field', async () => {
		const { store, id, peer, field } = await setup({ title: 'Original' });
		const title = field('Title');
		await userEvent.click(title);
		await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}Alice');
		await idle();
		await peer({ title: 'Bob, later' });

		await userEvent.keyboard('{Tab}');
		expect(store.get(id)?.title).toBe('Bob, later');
	});

	it('writes nothing when the sheet closes either', async () => {
		const { store, id, peer, field, view } = await setup({ title: 'Original' });
		await userEvent.click(field('Description'));
		await userEvent.keyboard('Mine');
		await idle();
		expect(store.get(id)?.description).toBe('Mine');
		await peer({ description: 'Theirs, later' });

		view.unmount();
		expect(store.get(id)?.description).toBe('Theirs, later');
	});

	it('Cmd+Enter in the description after the peer value appeared keeps the peer value', async () => {
		const { store, id, peer, field } = await setup({ title: 'Has a body' });
		const description = field('Description');
		await userEvent.click(description);
		await userEvent.keyboard('Mine');
		await idle();
		await peer({ description: 'Theirs, later' });
		expect(description.value).toBe('Theirs, later');

		await userEvent.keyboard('{ControlOrMeta>}{Enter}{/ControlOrMeta}');
		expect(store.get(id)?.description).toBe('Theirs, later');
	});

	it('Enter after the peer value appeared keeps the peer value', async () => {
		const { store, id, peer, field } = await setup({ title: 'Original' });
		const title = field('Title');
		await userEvent.click(title);
		await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}Alice');
		await idle();
		await peer({ title: 'Bob, later' });

		await userEvent.keyboard('{Enter}');
		expect(store.get(id)?.title).toBe('Bob, later');
		expect(title.value).toBe('Bob, later');
	});

	it('typing again carries on from the peer value', async () => {
		const { store, id, peer, field } = await setup({ title: 'Original' });
		const title = field('Title');
		await userEvent.click(title);
		await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}Alice');
		await idle();
		await peer({ title: 'Bob' });

		title.setSelectionRange(3, 3);
		await userEvent.keyboard(' and Alice{Enter}');
		expect(store.get(id)?.title).toBe('Bob and Alice');
	});

	it('still keeps what you typed after the commit, and writes it on leaving', async () => {
		const { store, id, peer, field } = await setup({ title: 'Original' });
		const title = field('Title');
		await userEvent.click(title);
		await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}Alice');
		await idle();
		// New input the document has not seen yet: this is the concurrent case, and the
		// person still typing keeps their text until they are done.
		await userEvent.keyboard(' again');
		await peer({ title: 'Bob' });
		expect(title.value).toBe('Alice again');

		await userEvent.keyboard('{Tab}');
		expect(store.get(id)?.title).toBe('Alice again');
	});

	it('keeps the trailing space being typed when nobody else changed the title', async () => {
		const { store, id, field } = await setup({ title: 'Original' });
		const title = field('Title');
		await userEvent.click(title);
		await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}Two words ');
		await idle();
		expect(store.get(id)?.title).toBe('Two words');
		expect(title.value).toBe('Two words ');
	});

	it('Escape after the peer value appeared keeps the peer value', async () => {
		const { store, id, peer, field } = await setup({ title: 'Original' });
		const title = field('Title');
		await userEvent.click(title);
		await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}Alice');
		await idle();
		await peer({ title: 'Bob, later' });

		await userEvent.keyboard('{Escape}');
		expect(store.get(id)?.title).toBe('Bob, later');
		expect(title.value).toBe('Bob, later');
	});

	it.each([true, false])(
		'converges on what the document settled on after a concurrent edit (peer id above: %s)',
		async (above) => {
			const { store, id, concurrentPeer, field } = await setup({ title: 'Original' });
			const title = field('Title');
			const grace = concurrentPeer(above);
			await userEvent.click(title);
			await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}Ada');
			await idle();

			await grace({ title: 'Grace' });
			const settled = store.get(id)?.title;
			expect(['Ada', 'Grace']).toContain(settled);
			expect(title.value).toBe(settled);

			await userEvent.keyboard('{Tab}');
			expect(store.get(id)?.title).toBe(settled);
		}
	);
});
