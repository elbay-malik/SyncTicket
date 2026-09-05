// Phase 6 acceptance: a 10,000-issue workspace stays responsive and bounded.
//
// The stylesheet import is load-bearing, not decoration: the virtualizer sizes itself from
// its scroll parent, and without Tailwind the container has no height, so it would render
// every row and the test would prove nothing.

import '../../../routes/layout.css';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { IssueStore } from '$lib/state/issues.svelte.js';
import { IssueQuery } from '$lib/state/queries.svelte.js';
import IssueList from './issue-list.svelte';

const N = 10_000;
/** Generous enough to survive a taller viewport, small enough to prove virtualization. */
const MAX_RENDERED = 100;

const stores: IssueStore[] = [];
const hosts: HTMLElement[] = [];

function makeStore() {
	const store = new IssueStore(`vlist-${crypto.randomUUID()}`);
	stores.push(store);
	return store;
}

/** A viewport with a real height, which is what bounds the virtualizer. */
function makeHost() {
	const host = document.createElement('div');
	host.style.height = '600px';
	document.body.appendChild(host);
	hosts.push(host);
	return host;
}

afterEach(() => {
	while (stores.length) stores.pop()?.destroy();
	while (hosts.length) hosts.pop()?.remove();
});

const settle = () =>
	new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

describe('issue-list.svelte at 10k', () => {
	it('renders a bounded window of rows, not the whole list', async () => {
		const store = makeStore();
		store.seed(N, { seed: 1 });
		flushSync();
		const query = new IssueQuery(store);
		expect(query.results).toHaveLength(N);

		const host = makeHost();
		await render(IssueList, { target: host, props: { issues: query.results, store } });
		flushSync();
		await settle();

		const rendered = host.querySelectorAll('li').length;
		expect(rendered).toBeGreaterThan(0);
		expect(rendered).toBeLessThan(MAX_RENDERED);
	}, 60_000);

	it('shows different issues after scrolling, and still only a window of them', async () => {
		const store = makeStore();
		store.seed(N, { seed: 2 });
		flushSync();
		const query = new IssueQuery(store);

		const host = makeHost();
		await render(IssueList, { target: host, props: { issues: query.results, store } });
		flushSync();
		await settle();

		const first = host.querySelector('li')?.textContent ?? '';
		const scroller = host.querySelector<HTMLElement>('[data-testid="issue-list"]');
		expect(scroller).not.toBeNull();

		scroller!.scrollTop = 20_000;
		scroller!.dispatchEvent(new Event('scroll'));
		await settle();
		await settle();

		expect(host.querySelector('li')?.textContent ?? '').not.toBe(first);
		expect(host.querySelectorAll('li').length).toBeLessThan(MAX_RENDERED);
	}, 60_000);

	it('re-renders its window when the underlying data changes', async () => {
		const store = makeStore();
		store.seed(N, { seed: 3 });
		flushSync();
		const query = new IssueQuery(store);

		const host = makeHost();
		// `issues` is a plain array here; in the app the layout passes the reactive
		// `query.results`, whose CRDT-to-runes wiring is proven in issues.svelte.test.ts.
		const result = await render(IssueList, {
			target: host,
			props: { issues: query.results, store }
		});
		flushSync();
		await settle();

		const visibleId = query.results[0]!.id;
		store.update(visibleId, { title: 'Edited while huge' });
		flushSync();
		expect(store.get(visibleId)?.title).toBe('Edited while huge');

		await result.rerender({ issues: query.results, store });
		flushSync();
		await settle();
		expect(host.textContent).toContain('Edited while huge');
		expect(host.querySelectorAll('li').length).toBeLessThan(MAX_RENDERED);
	}, 60_000);
});
