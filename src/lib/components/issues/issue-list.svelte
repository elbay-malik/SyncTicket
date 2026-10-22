<script lang="ts">
	// The list is virtualized because the DOM is the only thing that does not scale here.
	// Measured at 10,000 issues before this change: filtering and sorting the whole set took
	// 2 ms and a single field edit reached the DOM in under 1 ms, but rendering every row
	// cost 5.0 s and 168,000 nodes. The Phase 3 query index was never the problem; the 17
	// nodes per row were.
	//
	// `Virtualizer` (rather than virtua's self-contained `VList`) because it lets the item
	// element be a real <li> inside a real <ul>: the rows keep their list semantics for
	// assistive technology, and every existing test that looks for a listitem still works.
	// Its scroll container is its direct parent, which is the bordered div below.
	//
	// Keyboard navigation is a roving focus rather than an ARIA selection model. `<li>` does
	// not support aria-selected, and virtua renders the `<ul>` itself so nothing can be put
	// on it, so "selected" is expressed the way the platform already understands: the cursor
	// row's link is the one tabbable element in the whole list, and moving the cursor moves
	// real focus to it. That also leaves Enter alone — activating a focused link is the
	// browser's job, not a global shortcut's, which would otherwise suppress Enter on every
	// button in the app.
	//
	// Focus *is* the cursor, so there is no second copy of it kept in state. A move reads
	// whichever row focus is in and lands on the next row's link, unconditionally — which is
	// what keeps j-then-Enter opening an issue even when focus was last left on a picker by
	// a mouse click. The row's two pickers are reached with Left/Right, which moves focus
	// and remembers nothing: a remembered column made j land on the next row's picker, and
	// Enter there opened a dropdown instead of the issue.
	//
	// The pickers therefore carry tabindex=-1 in every row. As ordinary buttons they were
	// tabbable in their own right, so Tab walked each rendered row three times over and the
	// first Tab into the list landed on row 1's status button rather than at the cursor.

	import { Virtualizer } from 'virtua/svelte';
	import type { Issue } from '$lib/model/issue.js';
	import type { IssueStore } from '$lib/state/issues.svelte.js';
	import { getPresence } from '$lib/state/presence.svelte.js';
	import IssueRow from './issue-row.svelte';

	let {
		issues,
		store,
		selectedId = $bindable(null)
	}: { issues: Issue[]; store: IssueStore; selectedId?: string | null } = $props();

	// One shared index for the whole list: `viewersOf` is a map lookup, so adding presence
	// costs each row a hash probe rather than a scan over everyone in the workspace.
	const presence = $derived(getPresence(store));

	let scroller = $state<HTMLElement | null>(null);
	let virtualizer = $state<ReturnType<typeof Virtualizer> | null>(null);
	/** The row to mark as just-created; see `reveal`. */
	let flashId = $state<string | null>(null);
	/** An id waiting to be scrolled to, held until the row actually exists. */
	let pendingReveal = $state<string | null>(null);

	const selectedIndex = $derived(issues.findIndex((issue) => issue.id === selectedId));

	// Roving tabindex needs exactly one tabbable row. Before the cursor has been placed that
	// is the first row, so a single Tab always enters the list somewhere sensible.
	const tabbableIndex = $derived(
		selectedIndex === -1 ? (issues.length > 0 ? 0 : -1) : selectedIndex
	);

	// Both of the next two are read off `tabbableIndex` rather than off `selectedId`, and
	// that is the whole point: virtua renders a window, not the list, so the row carrying the
	// tab stop has to be pinned in the DOM or Tab has nothing to enter the list at. Deriving
	// the pinned index from the tabbable one makes them incapable of disagreeing — when they
	// were computed separately, the no-cursor fallback was tabbable but not pinned, and
	// scrolling away from the top left the list with zero tab stops.
	const tabbableId = $derived(issues[tabbableIndex]?.id ?? null);
	const keepMounted = $derived(tabbableIndex === -1 ? [] : [tabbableIndex]);

	/**
	 * The row focus is sitting in, or null when focus is outside this list entirely.
	 *
	 * Read at the moment of a move rather than mirrored into state from a focus event: a
	 * mirror has to be invalidated by hand, and the one that was here wrote a remembered
	 * column from any focus at all — including a mouse click on a picker, after which j
	 * moved the cursor down a row and left focus on that row's picker instead of its link.
	 */
	/**
	 * The row a scheduled move is about to focus, or null when nothing is in flight.
	 *
	 * Plain `let`, not `$state`: this is scheduling bookkeeping that nothing renders, and
	 * making it reactive would invalidate derivations on every keypress for no gain.
	 */
	let pendingFocusId: string | null = null;

	function focusedRowId(): string | null {
		const active = document.activeElement;
		if (!(active instanceof Element) || !scroller?.contains(active)) return null;
		return active.closest<HTMLElement>('[data-issue-row]')?.dataset.issueRow ?? null;
	}

	/**
	 * Moves the cursor and follows it with real focus, always onto the row's link.
	 *
	 * Focus is what makes a screen reader announce the row, and it is only possible if the
	 * row exists — which in a virtualized list it usually does not, since the cursor can jump
	 * far outside the rendered window. `keepMounted` above guarantees the cursor's row stays
	 * in the DOM, so this only has to wait one frame for the move to be laid out.
	 */
	/**
	 * Takes the cursor to an issue and says so — for an issue the visitor just created.
	 *
	 * Quick-add appends after the maximum order key, so under the default sort a new issue
	 * lands at the END of the list, which in a virtualized list means off-screen. Before this,
	 * pressing Enter cleared the field and produced no other visible change anywhere: the one
	 * interaction that could demonstrate "instant by construction" was the one that looked
	 * like nothing had happened.
	 *
	 * `await tick()` because the row does not exist yet at call time. `create()` returns the id
	 * synchronously, but the Yjs observer -> projection -> `$derived` chain has not produced the
	 * new `issues` array when the caller's handler is still running, so an index lookup here
	 * would find -1 and scroll nowhere.
	 */
	export function reveal(id: string) {
		selectedId = id;
		flashId = id;
		pendingReveal = id;
		// Clearing on a timer rather than on animationend: with prefers-reduced-motion the
		// animation is cut to 0.01ms and may finish before the class is even observed, and an
		// event that never arrives would pin the class forever.
		setTimeout(() => {
			if (flashId === id) flashId = null;
		}, 900);
	}

	// The scroll waits for the row to exist, however long that takes.
	//
	// It cannot be done inline in `reveal`: `create()` returns the id synchronously, but the
	// issue reaches this component through Yjs observer -> projection -> `$derived` -> prop,
	// and one `await tick()` is measurably not enough — the index lookup finds -1 and the list
	// never moves, which is exactly the "nothing happened" this feature exists to fix. An
	// effect re-runs when `issues` changes, so it scrolls on the render the row first appears
	// in, whichever one that is.
	$effect(() => {
		const id = pendingReveal;
		if (id === null) return;
		const index = issues.findIndex((issue) => issue.id === id);
		if (index === -1) return;
		pendingReveal = null;
		// Two scrolls, because two different things can be out of view. `scrollToIndex` moves
		// virtua's own scroller so the row enters the rendered window. That is not enough on its
		// own: the list is `h-full` inside the route column, so at short viewport heights the
		// list has nothing to scroll and `<main>` is the scroller — `scrollToIndex` then
		// succeeds and moves nothing, which is how this shipped broken the first time. The row
		// is in the DOM either way (`keepMounted` pins the cursor's row), so asking the element
		// itself to come into view scrolls whichever ancestor is actually scrolling.
		virtualizer?.scrollToIndex(index, { align: 'nearest' });
		requestAnimationFrame(() => {
			scroller
				?.querySelector(`[data-issue-link="${CSS.escape(id)}"]`)
				?.scrollIntoView({ block: 'nearest' });
		});
	});

	export function moveCursor(delta: number) {
		if (issues.length === 0) return;
		// Start from where focus actually is, so a move after a click (or after bits-ui hands
		// focus back to a picker) continues from the row the user was last in — but only when
		// no move is still in flight. A queued move has already advanced `selectedId` while
		// focus is necessarily still on the row it started from, so consulting focus again
		// would read a stale origin and the two moves would collapse into one. That is the
		// ordinary held-key case, not a corner: OS auto-repeat fires every 15-30 ms against a
		// 16.7 ms frame, and far faster than that while virtua re-renders a long list.
		const focusedId = pendingFocusId === null ? focusedRowId() : null;
		const at =
			focusedId === null ? selectedIndex : issues.findIndex((issue) => issue.id === focusedId);
		const from = at === -1 ? (delta > 0 ? -1 : 0) : at;
		const next = Math.min(issues.length - 1, Math.max(0, from + delta));
		const issue = issues[next];
		if (!issue) return;
		selectedId = issue.id;
		virtualizer?.scrollToIndex(next, { align: 'nearest' });
		// One frame's worth of focus, not one callback per keypress: every move within a frame
		// would otherwise focus a row the cursor has already left behind.
		const scheduled = pendingFocusId !== null;
		pendingFocusId = issue.id;
		if (scheduled) return;
		requestAnimationFrame(() => {
			const target = pendingFocusId;
			pendingFocusId = null;
			if (target === null) return;
			scroller
				?.querySelector<HTMLElement>(`[data-issue-link="${CSS.escape(target)}"]`)
				?.focus({ preventScroll: true });
		});
	}

	/**
	 * Moves focus across the controls of the row it is already in — a within-row convenience,
	 * not a second cursor. Nothing is stored, so the next Up/Down still lands on a link.
	 *
	 * Every focusable element in a row carries an explicit tabindex (the pickers -1 always,
	 * the link 0 on the cursor row), which is what makes `[tabindex]` the row's control list
	 * in visual order. Returns whether it moved, so a key that did nothing keeps its default.
	 */
	function moveWithinRow(delta: number, from: HTMLElement): boolean {
		const row = from.closest('[data-issue-row]');
		if (!row) return false;
		const controls = [...row.querySelectorAll<HTMLElement>('[tabindex]')];
		const at = controls.indexOf(from);
		if (at === -1) return false;
		// Clamped rather than wrapped, so the ends of a row are felt.
		const target = controls[Math.min(controls.length - 1, Math.max(0, at + delta))];
		if (!target || target === from) return false;
		target.focus({ preventScroll: true });
		return true;
	}

	function onKeydown(event: KeyboardEvent) {
		// A control that already acted owns the key: bits-ui's pickers open their menu on
		// ArrowDown and call preventDefault, and without this guard the list moved the cursor
		// as well, tearing focus out of the menu that had just opened.
		if (event.defaultPrevented) return;
		if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;

		const down = event.key === 'ArrowDown' || event.key === 'j';
		const up = event.key === 'ArrowUp' || event.key === 'k';
		if (down || up) {
			event.preventDefault();
			moveCursor(down ? 1 : -1);
			return;
		}

		const right = event.key === 'ArrowRight';
		const left = event.key === 'ArrowLeft';
		if (!left && !right) return;
		if (!(event.target instanceof HTMLElement)) return;
		if (moveWithinRow(right ? 1 : -1, event.target)) event.preventDefault();
	}
</script>

<!--
	The handler is a delegation point for keys pressed on the rows inside, not a control of
	its own: the list semantics live on the <ul> that virtua renders within.
-->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={scroller}
	onkeydown={onKeydown}
	tabindex="-1"
	class="h-full overflow-y-auto rounded-lg border outline-none"
	data-testid="issue-list"
>
	<Virtualizer
		bind:this={virtualizer}
		data={issues}
		getKey={(issue: Issue) => issue.id}
		as="ul"
		item="li"
		itemProps={() => ({ class: 'border-b last:border-b-0' })}
		{keepMounted}
	>
		{#snippet children(issue: Issue)}
			<IssueRow
				{issue}
				{store}
				selected={issue.id === selectedId}
				tabbable={issue.id === tabbableId}
				flash={issue.id === flashId}
				viewers={presence.viewersOf(issue.id)}
			/>
		{/snippet}
	</Virtualizer>
</div>
