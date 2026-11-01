// The audit's exploit from the visitor's side, against the real components and SvelteKit's real
// `resolve()`. Issue ids are Y.Map keys, so a peer chooses them. A key like `../issues?ws=...`
// used to be a row whose title moved whoever clicked it into another workspace, and `''`, `/x`
// or `x/` made `resolve()` throw while the list rendered, for everyone in the workspace.
//
// Two layers, so two halves. A peer's delivery is stopped at the read and never becomes a row.
// Behind that, a row handed such an id directly still gets a link that stays where it belongs.

import '../../../routes/layout.css';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { goto } from '$app/navigation';
import type { Issue } from '$lib/model/issue.js';
import { IssueStore } from '$lib/state/issues.svelte.js';
import { STOLEN_LINK, peerWrites, wellFormedIssue } from '$lib/sync/junk-entries.fixture.js';
import BoardColumn from './board-column.svelte';
import IssueList from './issue-list.svelte';
import IssueRow from './issue-row.svelte';

vi.mock('$app/navigation', async (importOriginal) => ({
	...(await importOriginal<typeof import('$app/navigation')>()),
	goto: vi.fn()
}));

const AUDITED_IDS = [STOLEN_LINK, '', '/x', 'x/'].map((id) => ({ id }));

const cleanups: Array<() => void> = [];

beforeEach(() => {
	vi.mocked(goto).mockClear();
});

afterEach(() => {
	while (cleanups.length) cleanups.pop()?.();
});

function makeHost(): HTMLElement {
	const host = document.createElement('div');
	host.style.height = '400px';
	document.body.appendChild(host);
	cleanups.push(() => host.remove());
	return host;
}

/** A loaded store, and a peer who can deliver to it the way the relay would. */
async function makeWorkspace() {
	let doc = null as Y.Doc | null;
	const store = new IssueStore(`hostile-${crypto.randomUUID()}`, {
		attachRelay: (attached) => {
			doc = attached;
			const awareness = new Awareness(attached);
			clearInterval(awareness._checkInterval);
			return { provider: null, awareness, destroy: () => awareness.destroy() };
		}
	});
	cleanups.push(() => store.destroy());
	await vi.waitFor(() => expect(store.synced).toBe(true));
	const target = doc as unknown as Y.Doc;
	return {
		store,
		peer: (write: (issues: Y.Map<unknown>) => void) => peerWrites(target, write)
	};
}

const issueWithId = (id: string): Issue => ({
	id,
	title: 'Fix login',
	description: '',
	status: 'todo',
	priority: 'none',
	assignee: null,
	labels: [],
	order: 'a0',
	createdAt: 1,
	updatedAt: 1
});

/** The virtualizer lays its rows out over a frame or two; asserting before that proves nothing. */
const settle = () =>
	new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

/** The only thing a click could do: where this link goes, once the browser has normalised it. */
function destination(link: HTMLAnchorElement) {
	return { path: link.pathname, search: link.search, origin: link.origin };
}

describe.each(AUDITED_IDS)('a peer delivering a titled issue under the key $id', ({ id }) => {
	it('puts no row and no link in the list it arrives at', async () => {
		const { store, peer } = await makeWorkspace();
		const kept = store.create({ title: 'Kept', status: 'todo' });
		const host = makeHost();
		const list = await render(IssueList, { target: host, props: { issues: store.all, store } });

		peer((issues) => issues.set(id, wellFormedIssue()));
		await list.rerender({ issues: store.all });
		await settle();

		expect(store.get(id)).toBeUndefined();
		expect(store.all.map((issue) => issue.id)).toEqual([kept]);
		expect(host.textContent).toContain('Kept');
		expect(host.textContent).not.toContain('Fix login');
		const links = [...host.querySelectorAll('a')];
		expect(links.map((link) => link.dataset.issueLink)).toEqual([kept]);
		expect(links[0]?.getAttribute('href')).toBe(`/issues/${kept}`);
	});

	it('puts no row in a list opened after it arrived', async () => {
		const { store, peer } = await makeWorkspace();
		const kept = store.create({ title: 'Kept', status: 'todo' });
		peer((issues) => issues.set(id, wellFormedIssue()));
		const host = makeHost();
		await render(IssueList, { target: host, props: { issues: store.all, store } });
		await settle();

		// First, because on a key `resolve()` throws for, the render dies outside the test's reach.
		expect(store.all.map((issue) => issue.id)).toEqual([kept]);
		expect(host.textContent).toContain('Kept');
		expect(host.textContent).not.toContain('Fix login');
		expect([...host.querySelectorAll('a')].map((link) => link.dataset.issueLink)).toEqual([kept]);
	});

	it('puts no card on the board', async () => {
		const { store, peer } = await makeWorkspace();
		const kept = store.create({ title: 'Kept', status: 'todo' });
		peer((issues) => issues.set(id, wellFormedIssue()));
		const host = makeHost();
		await render(BoardColumn, {
			target: host,
			props: { status: 'todo', items: store.all, onconsider: () => {}, onfinalize: () => {} }
		});

		const cards = [...host.querySelectorAll<HTMLElement>('[data-issue-id]')];
		expect(cards.map((card) => card.dataset.issueId)).toEqual([kept]);
		expect(host.textContent).not.toContain('Fix login');
	});
});

describe('the links themselves', () => {
	async function rowLink(issue: Issue): Promise<HTMLAnchorElement> {
		const { store } = await makeWorkspace();
		const host = makeHost();
		await render(IssueRow, { target: host, props: { issue, store } });
		return host.querySelector('a') as HTMLAnchorElement;
	}

	it('leave a real id exactly as it is', async () => {
		const id = crypto.randomUUID();
		const link = await rowLink(issueWithId(id));
		expect(link.getAttribute('href')).toBe(`/issues/${id}`);
		expect(link.dataset.issueLink).toBe(id);
	});

	// Past the read, as a second layer: nothing can hand a row one of these today.
	it.each([STOLEN_LINK, '/x', 'x/', 'a#b', 'a?b', '../../board'])(
		'keep %s inside one path segment under /issues/',
		async (id) => {
			const link = await rowLink(issueWithId(id));
			const { path, search, origin } = destination(link);
			expect(origin).toBe(location.origin);
			expect(search).toBe('');
			expect(link.hash).toBe('');
			expect(path.split('/').slice(0, 2)).toEqual(['', 'issues']);
			expect(path.split('/')).toHaveLength(3);
			// What SvelteKit's decoding hands back as `page.params.id`.
			expect(decodeURIComponent(path.split('/')[2] as string)).toBe(id);
		}
	);

	it('go the same way from a board card', async () => {
		const real = crypto.randomUUID();
		const host = makeHost();
		await render(BoardColumn, {
			target: host,
			props: {
				status: 'todo',
				items: [issueWithId(real), issueWithId(STOLEN_LINK)],
				onconsider: () => {},
				onfinalize: () => {}
			}
		});

		const cards = [...host.querySelectorAll<HTMLElement>('[data-issue-id]')];
		cards[0]?.click();
		cards[1]?.click();

		expect(vi.mocked(goto).mock.calls.map(([href]) => href)).toEqual([
			`/issues/${real}`,
			`/issues/${encodeURIComponent(STOLEN_LINK)}`
		]);
	});
});
