// Phase 6 acceptance: a 10,000-issue workspace stays responsive and bounded.
//
// The stylesheet import is load-bearing, not decoration: the virtualizer sizes itself from
// its scroll parent, and without Tailwind the container has no height, so it would render
// every row and the test would prove nothing.

import '../../../routes/layout.css';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { sectionByStatus } from '$lib/model/query.js';
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

/**
 * Everything inside the list a Tab press could land on.
 *
 * Reads the `tabIndex` *property*, not a `[tabindex]` attribute selector: a `<button>` with
 * no tabindex at all reports 0, which is exactly how the row's two pickers used to smuggle
 * themselves into the tab order while the attribute-based assertion above stayed green.
 */
function tabStops(host: HTMLElement): HTMLElement[] {
	const list = host.querySelector<HTMLElement>('[data-testid="issue-list"]');
	return [...(list?.querySelectorAll<HTMLElement>('a, button') ?? [])].filter(
		(element) => element.tabIndex === 0
	);
}

const rowOf = (element: Element | null | undefined) =>
	element?.closest<HTMLElement>('[data-issue-row]')?.dataset.issueRow ?? null;

/**
 * The ids of the rows currently in the DOM, in document order.
 *
 * Not the same as "the rows on screen": the row carrying the tab stop is pinned with virtua's
 * `keepMounted`, so it stays mounted however far the window has scrolled away from it. That
 * is why the scrolling assertions below compare whole sets rather than the first `<li>`.
 */
const renderedRowIds = (host: HTMLElement) =>
	[...host.querySelectorAll<HTMLElement>('[data-issue-row]')].map((row) => row.dataset.issueRow!);

const active = () => document.activeElement as HTMLElement | null;

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

		const before = renderedRowIds(host);
		const scroller = host.querySelector<HTMLElement>('[data-testid="issue-list"]');
		expect(scroller).not.toBeNull();

		scroller!.scrollTop = 20_000;
		scroller!.dispatchEvent(new Event('scroll'));
		await settle();
		await settle();

		// The whole window turned over. The one row that survives is the first, which carries
		// the tab stop while no cursor has been placed and so is pinned in the DOM.
		const after = renderedRowIds(host);
		expect(after.filter((id) => before.includes(id))).toEqual([query.results[0]!.id]);
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

	it('moves the cursor into rows that were never mounted', async () => {
		const store = makeStore();
		store.seed(N, { seed: 4 });
		flushSync();
		const query = new IssueQuery(store);

		const host = makeHost();
		const result = await render(IssueList, {
			target: host,
			props: { issues: query.results, store }
		});
		flushSync();
		await settle();

		// Walk far enough that the target row was outside the initial window entirely.
		for (let i = 0; i < 60; i += 1) result.component.moveCursor(1);
		flushSync();

		// Scrolling, re-rendering the window and moving focus all happen across frames, so
		// wait for the outcome rather than guessing how many.
		await vi.waitFor(() => {
			const focused = document.activeElement as HTMLElement | null;
			expect(focused?.dataset.issueLink).toBe(query.results[59]!.id);
		});
		// Still a window, not the whole list.
		expect(host.querySelectorAll('li').length).toBeLessThan(MAX_RENDERED);
	}, 60_000);

	it('keeps exactly one row tabbable so Tab enters the list once', async () => {
		const store = makeStore();
		store.seed(200, { seed: 5 });
		flushSync();
		const query = new IssueQuery(store);

		const host = makeHost();
		const result = await render(IssueList, {
			target: host,
			props: { issues: query.results, store }
		});
		flushSync();
		await settle();

		expect(host.querySelectorAll('a[tabindex="0"]').length).toBe(1);
		result.component.moveCursor(1);
		result.component.moveCursor(1);
		flushSync();
		await settle();
		expect(host.querySelectorAll('a[tabindex="0"]').length).toBe(1);
	}, 60_000);
});

// Roving tabindex, in the two states the app actually reaches it in.
//
// A11Y-03 was that the row's pickers were ordinary buttons: every rendered row carried three
// tab stops, so Tab walked the window instead of entering it once, and it entered at row 1's
// status button rather than at the cursor. The two failures that the first fix for it
// introduced are the last two tests here — an unreachable list once scrolled, and a cursor
// move that landed on a picker so Enter opened a dropdown instead of the issue.
describe('issue-list.svelte roving tabindex', () => {
	it('exposes exactly one tab stop, and it sits on the cursor row', async () => {
		const store = makeStore();
		store.seed(200, { seed: 6 });
		flushSync();
		const query = new IssueQuery(store);

		const host = makeHost();
		const result = await render(IssueList, {
			target: host,
			props: { issues: query.results, store }
		});
		flushSync();
		await settle();

		// Several rows are rendered, so a per-row tab stop would show up as several.
		expect(host.querySelectorAll('li').length).toBeGreaterThan(2);
		expect(tabStops(host)).toHaveLength(1);
		// Before the cursor has been placed the stop is the first row's link.
		expect(tabStops(host)[0]?.dataset.issueLink).toBe(query.results[0]!.id);

		result.component.moveCursor(4);
		flushSync();
		await settle();

		const stops = tabStops(host);
		expect(stops).toHaveLength(1);
		expect(stops[0]?.dataset.issueLink).toBe(query.results[3]!.id);
	}, 60_000);

	it('walks a row with Left and Right without moving the tab stop off the link', async () => {
		const store = makeStore();
		store.seed(50, { seed: 7 });
		flushSync();
		const query = new IssueQuery(store);

		const host = makeHost();
		const result = await render(IssueList, {
			target: host,
			props: { issues: query.results, store }
		});
		flushSync();
		await settle();

		result.component.moveCursor(3);
		await vi.waitFor(() => expect(active()?.dataset.issueLink).toBe(query.results[2]!.id));
		const link = active();

		await userEvent.keyboard('{ArrowRight}');
		await vi.waitFor(() => expect(active()?.dataset.testid).toBe('priority-picker'));
		expect(rowOf(active())).toBe(query.results[2]!.id);
		// Within-row focus is a convenience, not a second cursor: the list's tab stop is still
		// the cursor row's link, so Tab back into the list lands somewhere Enter opens.
		expect(tabStops(host)).toEqual([link]);

		await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
		await vi.waitFor(() => expect(active()?.dataset.testid).toBe('status-picker'));

		// Clamped, not wrapped: Left at the start of a row stays put.
		await userEvent.keyboard('{ArrowLeft}');
		expect(active()?.dataset.testid).toBe('status-picker');

		// And the column is not remembered. ArrowUp rather than ArrowDown, because bits-ui
		// owns ArrowDown on a menu button — see the next test.
		await userEvent.keyboard('{ArrowUp}');
		await vi.waitFor(() => expect(active()?.dataset.issueLink).toBe(query.results[1]!.id));
		expect(tabStops(host)).toEqual([active()]);
	}, 60_000);

	it('leaves ArrowDown to a focused picker instead of moving the cursor as well', async () => {
		const store = makeStore();
		store.seed(20, { seed: 8 });
		flushSync();
		const query = new IssueQuery(store);

		const host = makeHost();
		const result = await render(IssueList, {
			target: host,
			props: { issues: query.results, store }
		});
		flushSync();
		await settle();

		result.component.moveCursor(2);
		await vi.waitFor(() => expect(active()?.dataset.issueLink).toBe(query.results[1]!.id));
		await userEvent.keyboard('{ArrowLeft}');
		await vi.waitFor(() => expect(active()?.dataset.testid).toBe('status-picker'));

		await userEvent.keyboard('{ArrowDown}');
		await expect.element(page.getByRole('menu')).toBeInTheDocument();
		// The cursor stayed put. Without the guard the list moved it too, tearing focus out
		// of the menu that had just opened.
		expect(tabStops(host)[0]?.dataset.issueLink).toBe(query.results[1]!.id);

		await userEvent.keyboard('{Escape}');
		await expect.element(page.getByRole('menu')).not.toBeInTheDocument();
		// bits-ui hands focus back to the trigger, which is deliberately not a tab stop.
		await vi.waitFor(() => expect(active()?.dataset.testid).toBe('status-picker'));
		expect(tabStops(host)[0]?.dataset.issueLink).toBe(query.results[1]!.id);
	}, 60_000);

	it('keeps a tab stop in the DOM after scrolling a long list with no cursor', async () => {
		const store = makeStore();
		store.seed(N, { seed: 9 });
		flushSync();
		const query = new IssueQuery(store);

		const host = makeHost();
		await render(IssueList, { target: host, props: { issues: query.results, store } });
		flushSync();
		await settle();
		expect(tabStops(host)).toHaveLength(1);

		// virtua renders a window, not the list. With the fallback row tabbable but not kept
		// mounted, scrolling away from the top unmounted the only tab stop there was and left
		// the list with no keyboard entry point at all — strictly worse than A11Y-03.
		const scroller = host.querySelector<HTMLElement>('[data-testid="issue-list"]')!;
		scroller.scrollTop = 20_000;
		scroller.dispatchEvent(new Event('scroll'));
		await settle();
		await settle();

		// The window really did move — row 1 is gone — so what follows is about a row that is
		// pinned, not about a list that never scrolled.
		const rendered = renderedRowIds(host);
		expect(rendered).not.toContain(query.results[1]!.id);
		expect(rendered).toContain(query.results[0]!.id);
		const stops = tabStops(host);
		expect(stops).toHaveLength(1);
		expect(stops[0]!.isConnected).toBe(true);

		// And it is reachable: a Tab from the scroll container itself enters the list rather
		// than skipping straight past it.
		scroller.focus();
		await userEvent.keyboard('{Tab}');
		await vi.waitFor(() => expect(active()?.dataset.issueLink).toBe(query.results[0]!.id));
	}, 60_000);

	it('moves the cursor onto a link even when focus was left on a picker', async () => {
		const store = makeStore();
		store.seed(20, { seed: 10 });
		flushSync();
		const query = new IssueQuery(store);

		const host = makeHost();
		const result = await render(IssueList, {
			target: host,
			props: { issues: query.results, store }
		});
		flushSync();
		await settle();

		// Exactly where a click on a row's status picker leaves focus once its menu closes.
		host
			.querySelector<HTMLElement>(
				`[data-issue-row="${CSS.escape(query.results[2]!.id)}"] [data-testid="status-picker"]`
			)!
			.focus();
		flushSync();
		await settle();

		// Verbatim what the global `j` shortcut runs. It has to continue from the row focus is
		// actually in, and land on that row's link: Enter is ordinary link activation, so a
		// cursor that landed on a picker opened a dropdown instead of the issue.
		result.component.moveCursor(1);
		await vi.waitFor(() => expect(active()?.dataset.issueLink).toBe(query.results[3]!.id));
		expect(active()?.tagName).toBe('A');
		expect(tabStops(host)).toEqual([active()]);
	}, 60_000);

	it('advances once per move when they arrive faster than a frame', async () => {
		const store = makeStore();
		store.seed(20, { seed: 11 });
		flushSync();
		const query = new IssueQuery(store);

		const host = makeHost();
		const result = await render(IssueList, {
			target: host,
			props: { issues: query.results, store }
		});
		flushSync();
		await settle();

		// Focus inside the list is the condition that makes this fail: the cursor's origin is
		// read from focus, but focus only follows a frame later, so every move made before the
		// browser paints used to read the same stale row and ten presses moved one row.
		host
			.querySelector<HTMLElement>(`[data-issue-link="${CSS.escape(query.results[0]!.id)}"]`)!
			.focus();
		flushSync();
		await settle();

		// Not a contrived burst: OS key auto-repeat runs at 15-30 ms against a 16.7 ms frame,
		// and the list does not filter `event.repeat`, so holding j is exactly this.
		for (let i = 0; i < 10; i += 1) result.component.moveCursor(1);

		await vi.waitFor(() => expect(active()?.dataset.issueLink).toBe(query.results[10]!.id));
		// Focus is moved once for the whole burst, on the row the cursor actually ended on.
		expect(active()?.tagName).toBe('A');
		expect(tabStops(host)).toEqual([active()]);
	}, 60_000);
});

describe('issue-list.svelte, sectioned by status', () => {
	/** The issues in the order a sectioned list shows them, which is what the cursor walks. */
	const onScreen = (issues: Parameters<typeof sectionByStatus>[0]) =>
		sectionByStatus(issues).flatMap((entry) => (entry.kind === 'issue' ? [entry.issue] : []));

	const headingFor = (host: HTMLElement, status: string) =>
		host.querySelector<HTMLElement>(`[data-list-section="${status}"]`);

	it('heads the list with real headings and still renders only a window at 10k', async () => {
		const store = makeStore();
		store.seed(N, { seed: 21 });
		flushSync();
		const query = new IssueQuery(store);
		const first = sectionByStatus(query.results)[0];

		const host = makeHost();
		await render(IssueList, {
			target: host,
			props: { issues: query.results, store, sectioned: true }
		});
		flushSync();
		await settle();

		expect(first?.kind).toBe('section');
		const heading = headingFor(host, first!.kind === 'section' ? first!.status : '');
		expect(heading?.querySelector('h2')).not.toBeNull();
		expect(host.querySelectorAll('li').length).toBeLessThan(MAX_RENDERED);
		// A heading is neither a tab stop nor somewhere the cursor can rest.
		expect(heading?.querySelector('a, button, [tabindex]')).toBeNull();
	}, 60_000);

	it('walks across a section boundary in screen order without stopping on the heading', async () => {
		const store = makeStore();
		store.seed(40, { seed: 22 });
		flushSync();
		const query = new IssueQuery(store);
		const shown = onScreen(query.results);
		// The first issue whose status differs from the one before it: the move onto it is
		// the one that crosses a heading.
		const boundary = shown.findIndex((issue, i) => i > 0 && issue.status !== shown[i - 1]!.status);
		expect(boundary).toBeGreaterThan(0);

		const host = makeHost();
		const result = await render(IssueList, {
			target: host,
			props: { issues: query.results, store, sectioned: true }
		});
		flushSync();
		await settle();

		for (let i = 0; i <= boundary; i += 1) result.component.moveCursor(1);
		await vi.waitFor(() => expect(active()?.dataset.issueLink).toBe(shown[boundary]!.id));
		expect(tabStops(host)).toEqual([active()]);
	}, 60_000);

	it('brings a section heading into view when k arrives at its first issue', async () => {
		const store = makeStore();
		store.seed(N, { seed: 23 });
		flushSync();
		const query = new IssueQuery(store);
		const shown = onScreen(query.results);
		const boundary = shown.findIndex((issue, i) => i > 0 && issue.status !== shown[i - 1]!.status);
		const status = shown[boundary]!.status;

		const host = makeHost();
		const result = await render(IssueList, {
			target: host,
			props: { issues: query.results, store, sectioned: true }
		});
		flushSync();
		await settle();

		// Start well below the boundary, then walk up to it one row at a time. Each upward
		// move pins its row to the top edge, so without the heading rule the last one parks
		// the section's first issue at the very top with its heading one row out of sight.
		const below = boundary + 40;
		for (let i = 0; i <= below; i += 1) result.component.moveCursor(1);
		await vi.waitFor(() => expect(active()?.dataset.issueLink).toBe(shown[below]!.id));
		for (let i = 0; i < below - boundary; i += 1) {
			result.component.moveCursor(-1);
			await settle();
		}
		await vi.waitFor(() => expect(active()?.dataset.issueLink).toBe(shown[boundary]!.id));
		await settle();

		const scroller = host.querySelector<HTMLElement>('[data-testid="issue-list"]')!;
		const heading = headingFor(host, status);
		expect(heading).not.toBeNull();
		expect(heading!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
			scroller.getBoundingClientRect().top
		);
	}, 60_000);
});
