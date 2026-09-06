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
	// row's link is the one tabbable element, and moving the cursor moves real focus to it.
	// That also leaves Enter alone — activating a focused link is the browser's job, not a
	// global shortcut's, which would otherwise suppress Enter on every button in the app.

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

	const selectedIndex = $derived(issues.findIndex((issue) => issue.id === selectedId));

	// Roving tabindex needs exactly one tabbable row. Before the cursor has been placed that
	// is the first row, so a single Tab always enters the list somewhere sensible.
	const tabbableId = $derived(selectedIndex === -1 ? (issues[0]?.id ?? null) : selectedId);

	// Keeps the cursor's row rendered even when it is scrolled far out of view, so focus has
	// something to land on the moment the cursor moves.
	const keepMounted = $derived(selectedIndex === -1 ? [] : [selectedIndex]);

	/**
	 * Moves the cursor and follows it with real focus.
	 *
	 * Focus is what makes a screen reader announce the row, and it is only possible if the
	 * row exists — which in a virtualized list it usually does not, since the cursor can jump
	 * far outside the rendered window. `keepMounted` below guarantees the cursor's row stays
	 * in the DOM, so this only has to wait one frame for the move to be laid out.
	 */
	export function moveCursor(delta: number) {
		if (issues.length === 0) return;
		const from = selectedIndex === -1 ? (delta > 0 ? -1 : 0) : selectedIndex;
		const next = Math.min(issues.length - 1, Math.max(0, from + delta));
		const issue = issues[next];
		if (!issue) return;
		selectedId = issue.id;
		virtualizer?.scrollToIndex(next, { align: 'nearest' });
		requestAnimationFrame(() => {
			scroller
				?.querySelector<HTMLElement>(`[data-issue-link="${CSS.escape(issue.id)}"]`)
				?.focus({ preventScroll: true });
		});
	}

	function onKeydown(event: KeyboardEvent) {
		// Arrows and j/k only; Enter, Tab and everything else belong to the focused element.
		const down = event.key === 'ArrowDown' || event.key === 'j';
		const up = event.key === 'ArrowUp' || event.key === 'k';
		if (!down && !up) return;
		if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
		event.preventDefault();
		moveCursor(down ? 1 : -1);
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
				viewers={presence.viewersOf(issue.id)}
			/>
		{/snippet}
	</Virtualizer>
</div>
