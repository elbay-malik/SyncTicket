// A peer's change, as the list shows it: a trace in the author's hue on the row it landed
// on, and a one-line notice when that row is not on screen.
//
// The record is written straight into `store.remote` here; which transactions get recorded
// is the store's business and is proven against a real Y.Doc in remote-activity.svelte.test.ts.
// The stylesheet is imported for the same reason the virtualization test imports it: without
// it the list has no height, renders every row, and "off-screen" never happens.

import '../../../routes/layout.css';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { IssueStore } from '$lib/state/issues.svelte.js';
import { TRACE_HOLD_FROM_MS, TRACE_MS, type RemoteChange } from '$lib/state/remote-change.js';
import IssueList from './issue-list.svelte';
import IssueRow from './issue-row.svelte';

const stores: IssueStore[] = [];
const hosts: HTMLElement[] = [];

function makeStore() {
	const store = new IssueStore(`remote-${crypto.randomUUID()}`);
	stores.push(store);
	return store;
}

function makeHost() {
	const host = document.createElement('div');
	host.style.height = '400px';
	document.body.appendChild(host);
	hosts.push(host);
	return host;
}

afterEach(() => {
	while (stores.length) stores.pop()?.destroy();
	while (hosts.length) hosts.pop()?.remove();
});

const ada = { userId: `u${'a'.repeat(32)}`, name: 'Ada Lovelace', hue: 210 };

function arrival(issueId: string, patch: Partial<RemoteChange> = {}): RemoteChange {
	return {
		issueId,
		kind: 'status',
		title: 'Fix login redirect',
		status: 'done',
		author: ada,
		at: Date.now(),
		...patch
	};
}

async function renderList(count: number) {
	const store = makeStore();
	const ids = Array.from({ length: count }, (_, i) => store.create({ title: `Issue ${i}` }));
	const host = makeHost();
	await render(IssueList, { target: host, props: { issues: store.all, store } });
	return { store, ids, host };
}

const traceOn = (host: HTMLElement, id: string) =>
	host.querySelector<HTMLElement>(`[data-issue-row="${id}"] [data-remote-trace]`);

describe('issue-list.svelte remote arrivals', () => {
	it('traces the row a peer changed, in that peer’s hue, then lets it go', async () => {
		const { store, ids, host } = await renderList(3);
		const id = ids[1] as string;

		store.remote.record(arrival(id));
		await expect.poll(() => traceOn(host, id)).not.toBeNull();
		const trace = traceOn(host, id) as HTMLElement;
		expect(trace.dataset.remoteTrace).toBe('status');
		expect(trace.dataset.remoteAuthor).toBe('Ada Lovelace');
		expect(trace.getAttribute('aria-hidden')).toBe('true');
		// The hue arrives as the validated number and nothing else; the colour is the theme's.
		expect(getComputedStyle(trace).getPropertyValue('--peer-h').trim()).toBe('210');
		expect(getComputedStyle(trace).boxShadow).toMatch(/inset/);
		// Only the changed row.
		expect(traceOn(host, ids[0] as string)).toBeNull();

		await expect.poll(() => traceOn(host, id), { timeout: TRACE_MS + 1000 }).toBeNull();
	});

	it('holds a continued run at full strength instead of blinking it', async () => {
		// A peer typing commits every 400ms; each commit must not replay the fade-in.
		const { store, ids, host } = await renderList(1);
		const id = ids[0] as string;
		const delay = () =>
			parseFloat(
				getComputedStyle(traceOn(host, id) as HTMLElement).getPropertyValue('--trace-delay')
			);

		store.remote.record(arrival(id, { kind: 'edited' }));
		await expect.poll(() => traceOn(host, id)).not.toBeNull();
		expect(delay()).toBeGreaterThan(-TRACE_HOLD_FROM_MS);

		const first = traceOn(host, id);
		store.remote.record(arrival(id, { kind: 'edited', at: Date.now() + 1 }));
		await expect.poll(() => traceOn(host, id)).not.toBe(first);
		expect(delay()).toBeLessThanOrEqual(-TRACE_HOLD_FROM_MS);
	});

	it('names the author with their initials, not by hue alone', async () => {
		// Several peer hues sit next to a status hue; a coloured frame beside a status glyph
		// read as status. The disc is the cue colour cannot be.
		const { store, ids, host } = await renderList(2);
		const id = ids[0] as string;
		const disc = () =>
			host.querySelector<HTMLElement>(`[data-issue-row="${id}"] [data-remote-trace-author]`);

		store.remote.record(arrival(id));
		await expect.poll(disc).not.toBeNull();
		expect(disc()?.textContent?.trim()).toBe('AL');
		expect(disc()?.dataset.remoteTraceAuthor).toBe('Ada Lovelace');
		expect(disc()?.getAttribute('aria-hidden')).toBe('true');
		expect(
			getComputedStyle(disc() as HTMLElement)
				.getPropertyValue('--peer-h')
				.trim()
		).toBe('210');
		await expect.poll(disc, { timeout: TRACE_MS + 1000 }).toBeNull();

		// Someone the browser cannot name gets the grey wash and no face.
		store.remote.record(arrival(id, { author: null }));
		await expect.poll(() => traceOn(host, id)).not.toBeNull();
		expect(disc()).toBeNull();
	});

	it('does not draw the author twice when they are already viewing the row', async () => {
		// A peer typing in the issue's sheet is in the row's viewer stack already.
		const store = makeStore();
		const id = store.create({ title: 'Watched' });
		const host = makeHost();
		await render(IssueRow, {
			target: host,
			props: {
				issue: store.get(id) as NonNullable<ReturnType<IssueStore['get']>>,
				store,
				viewers: [{ ...ada, activeIssueId: id, sessions: 1 }]
			}
		});
		store.remote.record(arrival(id, { kind: 'edited' }));
		await expect.poll(() => traceOn(host, id)).not.toBeNull();
		expect(host.querySelector('[data-remote-trace-author]')).toBeNull();
		expect(host.querySelectorAll('[data-peer="Ada Lovelace"]')).toHaveLength(1);
	});

	it('draws an unnamed author without a hue, rather than inventing one', async () => {
		const { store, ids, host } = await renderList(2);
		const id = ids[0] as string;

		store.remote.record(arrival(id, { author: null }));
		await expect.poll(() => traceOn(host, id)).not.toBeNull();
		expect(traceOn(host, id)?.classList.contains('remote-trace-anon')).toBe(true);
	});

	it('leaves no trace for this browser’s own edit', async () => {
		const { store, ids, host } = await renderList(2);
		store.update(ids[0] as string, { status: 'done', title: 'Mine' });
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(host.querySelector('[data-remote-trace]')).toBeNull();
	});

	it('says a change in one line when its row is off-screen, and not when it is visible', async () => {
		const { store, ids, host } = await renderList(60);
		const notice = () => host.ownerDocument.querySelector('[data-testid="remote-notice"]');

		// Row 0 is on screen: the trace says it, so the line stays out of the way.
		store.remote.record(arrival(ids[0] as string));
		await expect.poll(() => traceOn(host, ids[0] as string)).not.toBeNull();
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(notice()).toBeNull();

		// Row 59 is far below a 400px list, and the list must not be scrolled to it.
		const scroller = host.querySelector<HTMLElement>('[data-testid="issue-list"]') as HTMLElement;
		const before = scroller.scrollTop;
		store.remote.record(arrival(ids[59] as string, { title: 'Issue 59' }));
		await expect
			.poll(() => notice()?.querySelector('[data-remote-notice-text]')?.textContent?.trim())
			.toBe('Ada Lovelace moved “Issue 59” to Done');
		expect(notice()?.getAttribute('aria-hidden')).toBe('true');
		// The author's avatar rides along, so the line carries the same hue as the trace.
		expect(notice()?.querySelector('[data-peer="Ada Lovelace"]')).not.toBeNull();
		expect(scroller.scrollTop).toBe(before);
	});

	it('rewrites the line for a peer still typing off-screen, rather than replaying it', async () => {
		const { store, ids, host } = await renderList(60);
		const id = ids[59] as string;
		const mounted = new Set<Element>();
		const observer = new MutationObserver(() => {
			const element = host.ownerDocument.querySelector('[data-testid="remote-notice"]');
			if (element) mounted.add(element);
		});
		observer.observe(host.ownerDocument.body, { childList: true, subtree: true });

		// Idle commits of one typing run, each a fresh remote change to the same issue.
		for (const title of ['Is', 'Issue', 'Issue fif', 'Issue fifty']) {
			store.remote.record(arrival(id, { kind: 'edited', title }));
			await new Promise((resolve) => setTimeout(resolve, 450));
		}
		observer.disconnect();
		expect(mounted.size).toBe(1);
		expect(host.ownerDocument.querySelector('[data-remote-notice-text]')?.textContent?.trim()).toBe(
			'Ada Lovelace edited “Issue fifty”'
		);
	});

	it('keeps quiet about rows a peer adds into view, however fast they arrive', async () => {
		// The record lands inside the Yjs observer, in the same tick as the row it describes;
		// back-to-back adds must each be judged once their row can exist, not before.
		const store = makeStore();
		const host = makeHost();
		const seen: string[] = [];
		const observer = new MutationObserver(() => {
			const text = host.ownerDocument
				.querySelector('[data-testid="remote-notice"]')
				?.textContent?.trim();
			if (text && !seen.includes(text)) seen.push(text);
		});
		observer.observe(host.ownerDocument.body, { childList: true, subtree: true });
		store.create({ title: 'Alpha issue' });
		const { rerender } = await render(IssueList, {
			target: host,
			props: { issues: store.all, store }
		});
		for (const title of ['Beta issue', 'Gamma issue', 'Delta issue']) {
			const id = store.create({ title });
			store.remote.record(arrival(id, { kind: 'created', title, status: 'backlog' }));
			void rerender({ issues: store.all, store });
		}
		await expect.poll(() => host.querySelectorAll('[data-issue-row]').length).toBe(4);
		await new Promise((resolve) => setTimeout(resolve, 300));
		observer.disconnect();
		expect(seen).toEqual([]);
	});

	it('keeps the trace under reduced motion, as a state rather than a fade', () => {
		// The blanket reduced-motion block would cut the fade to 0.01ms and, with fill `both`,
		// end it on the invisible last keyframe — erasing the information, not just the motion.
		// The trace's own block replaces the animation with none, so its resting style shows.
		const rules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]);
		const reduce = rules.filter(
			(rule): rule is CSSMediaRule =>
				rule instanceof CSSMediaRule && rule.conditionText.includes('prefers-reduced-motion')
		);
		// The wash and the author's disc fade together, so both must stop together.
		for (const selector of ['.remote-trace', '.remote-trace-author']) {
			const traceRule = reduce
				.flatMap((media) => [...media.cssRules])
				.find(
					(rule): rule is CSSStyleRule =>
						rule instanceof CSSStyleRule &&
						rule.selectorText.split(',').some((part) => part.trim() === selector)
				);
			expect(traceRule?.style.getPropertyValue('animation-name'), selector).toBe('none');
			expect(traceRule?.style.getPropertyPriority('animation-name'), selector).toBe('important');
		}
	});
});
