<script lang="ts" module>
	import type { Options } from 'svelte-dnd-action';
	import { STATUS_META, issueIdParam, type Issue, type IssueStatus } from '$lib/model/issue.js';

	/**
	 * How long a touch must hold still before it becomes a drag.
	 *
	 * Without a delay the library calls `preventDefault()` on every touchstart that lands on
	 * a card (`pointerAction.js`: `useDelay = isTouchStart && config.delayTouchStartMs > 0`,
	 * then `if (!useDelay) e.preventDefault()`), and cards cover nearly the whole column — so
	 * on a phone almost no swipe could scroll the board. With a delay the gesture is left
	 * alone: move more than 3px before it elapses and the drag attempt is cancelled as a
	 * scroll; hold still and it is promoted to a drag, the conventional mobile pattern.
	 *
	 * The value is the cost of an accidental reorder. Once the delay elapses the finger owns
	 * the card, so a user who rests on a card for a beat before swiping drags it instead of
	 * scrolling — and that write is destructive. `delayTouchStart: true` would pick the
	 * library's own 80 ms, far inside the pause between touching a card and moving; 400 ms
	 * is the usual long-press threshold and has to be meant. It is safe to be this generous
	 * only because `beginTap`/`endTap` below make lifting the finger open the card at any
	 * hold length — without them a hold past this delay is a gesture that does nothing.
	 */
	export const TOUCH_DRAG_DELAY_MS = 400;

	/** Reorder animation. The library animates its drop to the same clock, hence one value. */
	export const FLIP_DURATION_MS = 150;

	/** Where a touch was, in viewport coordinates. */
	export interface TouchPoint {
		x: number;
		y: number;
	}

	/**
	 * How far a touch may travel and still count as a tap rather than a drag or a scroll.
	 *
	 * Comfortably above the library's own 3px `MIN_MOVEMENT_BEFORE_DRAG_START_PX`, because a
	 * gesture between the two is a drag that moved the card nowhere — opening the card is the
	 * better reading of it — and comfortably below the distance any real reorder covers.
	 */
	export const TAP_SLOP_PX = 10;

	/**
	 * Whether a touch that began on a card and ended at `end` was a tap.
	 *
	 * `start` is null once the gesture has been disowned: a second finger landing (a pinch),
	 * or a `touchcancel`. Distance is what separates the rest, because the events cannot: a
	 * press promoted to a drag by the hold timer and one that was never promoted at all end
	 * in the same plain `touchend`, and only the distance says which of them moved a card.
	 */
	export function isTapGesture(start: TouchPoint | null, end: TouchPoint): boolean {
		if (!start) return false;
		return Math.abs(end.x - start.x) < TAP_SLOP_PX && Math.abs(end.y - start.y) < TAP_SLOP_PX;
	}

	/**
	 * The drop zone's options, out here so the touch and reduced-motion contracts are
	 * assertable in Node (`board-drag.test.ts`) rather than only through a rendered board.
	 */
	export function dragOptions(items: Issue[], reducedMotion: boolean) {
		return {
			items,
			type: 'issues',
			// zoneTabIndex -1 keeps the five columns out of the idle tab order; the library
			// still raises it to 0 for eligible target zones while a drag runs, which is what
			// makes Tab-to-another-column work.
			zoneTabIndex: -1,
			flipDurationMs: reducedMotion ? 0 : FLIP_DURATION_MS,
			delayTouchStart: TOUCH_DRAG_DELAY_MS
		} satisfies Options<Issue>;
	}
</script>

<script lang="ts">
	// One Kanban column.
	//
	// Two structural rules come from svelte-dnd-action and both are load-bearing:
	//
	// 1. The zone's direct children must correspond one-to-one with the items handed to the
	//    action. The library indexes `node.children` positionally, makes each one a draggable,
	//    and reads the drag announcements off that element's aria-label — so the empty-state
	//    hint is a sibling of the zone, and the card markup is inline rather than a component
	//    behind an `animate:flip` wrapper, which would put a bare <div> in the card's place.
	// 2. A card must contain nothing focusable. The library drops the zone's children out of
	//    the tab order during a drag but not their descendants, and Tab onto a column is the
	//    only way to move a card between columns with the keyboard. So status and priority are
	//    static badges here and the card opens the detail sheet itself; editing lives there.

	import { flip } from 'svelte/animate';
	import { prefersReducedMotion } from 'svelte/motion';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import RemoteTrace from '$lib/components/presence/remote-trace.svelte';
	import RemoteTraceAuthor from '$lib/components/presence/remote-trace-author.svelte';
	import type { RemoteActivity } from '$lib/state/remote-activity.svelte.js';
	import PriorityBadge from './priority-badge.svelte';
	import StatusBadge from './status-badge.svelte';
	import { STATUS_UI } from './meta.js';

	let {
		status,
		items,
		total = items.length,
		onconsider,
		onfinalize,
		remote
	}: {
		status: IssueStatus;
		/** Already resolved by the board: the drag preview when one is in flight, else live. */
		items: Issue[];
		/** Issues in this status overall; larger than `items` once the render cap applies. */
		total?: number;
		onconsider: (event: CustomEvent<DndEvent<Issue>>) => void;
		onfinalize: (event: CustomEvent<DndEvent<Issue>>) => void;
		/** Peers' just-arrived changes, traced on the card they touched. */
		remote?: RemoteActivity;
	} = $props();

	const ui = $derived(STATUS_UI[status]);
	const label = $derived(STATUS_META[status].label);

	// Both animations here are JS-driven, so the `@media (prefers-reduced-motion)` rule in
	// layout.css cannot reach either of them — and a reorder can arrive from another replica
	// over the CRDT, which is motion this user never asked for at all. Svelte's media query is
	// reactive (and SSR-safe: a stub that reports false on the server), so changing the OS
	// setting takes effect without a reload.
	const options = $derived(dragOptions(items, prefersReducedMotion.current));

	// One tap can reach `open` three times, so it is deduplicated rather than made exact.
	// Measured in Chromium under touch emulation, a quick tap on a card fires: the library's
	// synthetic click (a bare `Event`, dispatched by `handleFalseAlarm` to stand in for the
	// one its touchstart `preventDefault()` used to suppress — except that with
	// `delayTouchStart` it suppresses nothing), the browser's own compatibility click, and
	// `endTap` below. Each would push the same route again, so Back would need three
	// presses. The window only has to outlast one gesture's worth of events.
	let lastOpened = { id: '', at: 0 };

	function open(id: string) {
		const at = performance.now();
		if (lastOpened.id === id && at - lastOpened.at < 500) return;
		lastOpened = { id, at };
		void goto(resolve('/issues/[id]', { id: issueIdParam(id) }));
	}

	/**
	 * Opening a card by tapping it, which the touch drag delay would otherwise take away.
	 *
	 * `TOUCH_DRAG_DELAY_MS` is what lets a swipe scroll the board, but it also means a press
	 * held past the delay is promoted to a real drag before the finger lifts — and promotion
	 * calls `removeMaybeListeners()`, which unregisters `handleFalseAlarm`, the only thing in
	 * the library that synthesises a click for touch. Lifting without moving then ends as a
	 * drag that puts the card back where it was: `moveIssue` writes nothing and nothing
	 * opens. That gesture is just a slow tap — what reading a card before deciding to open it
	 * looks like — so it is recognised here instead.
	 *
	 * Neither listener can live on the card, which is why they are up here. Promotion to a
	 * drag replaces the dragged item with a shadow item under a *different* id
	 * (`SHADOW_PLACEHOLDER_ITEM_ID`), so the keyed `{#each}` destroys the card's block and
	 * takes any handler bound to it with it, at exactly the moment this has to still work.
	 * The library keeps the DOM node alive by moving it to <body>, hidden, which is also why
	 * the end is watched on `window`: the node is no longer inside the zone. Touch events
	 * rather than pointer events, because Chromium re-targets `pointerup` to whatever is
	 * under the finger once the card is hidden and moved, while `touchend` always reaches the
	 * element its `touchstart` targeted. The start is watched in the capture phase because
	 * the library calls `stopPropagation()` on touchstart at the card itself.
	 */
	let tap: (TouchPoint & { id: string; touch: number }) | null = null;

	function beginTap(event: TouchEvent) {
		tap = null;
		// A second finger means a pinch or a two-handed scroll, never a tap.
		const touch = event.touches.length === 1 ? event.touches[0] : undefined;
		if (!touch) return;
		const id = (event.target as Element | null)
			?.closest?.('[data-issue-id]')
			?.getAttribute('data-issue-id');
		if (id) tap = { id, touch: touch.identifier, x: touch.clientX, y: touch.clientY };
	}

	function endTap(event: TouchEvent) {
		const started = tap;
		tap = null;
		if (!started) return;
		// `tap` is only ever set by this column's own zone, so the five window listeners do
		// not answer for each other; the identifier picks this gesture's finger back out.
		const touch = [...event.changedTouches].find((t) => t.identifier === started.touch);
		if (!touch || !isTapGesture(started, { x: touch.clientX, y: touch.clientY })) return;
		open(started.id);
	}
</script>

<svelte:window ontouchend={endTap} ontouchcancel={() => (tap = null)} />

<section class="bg-muted/40 flex w-72 shrink-0 flex-col rounded-xl border">
	<header class="flex items-center gap-2 px-3 py-2.5">
		<ui.icon class="size-4 {ui.class}" aria-hidden="true" />
		<h2 class="text-sm font-medium">{label}</h2>
		<Badge variant="secondary" class="ml-auto">{total}</Badge>
	</header>

	<div class="relative flex-1">
		{#if items.length === 0}
			<!-- Sibling of the zone on purpose: a child here would become a draggable. -->
			<p
				class="text-muted-foreground pointer-events-none absolute inset-x-3 top-4 text-center text-xs"
			>
				Drop issues here
			</p>
		{/if}
		<div
			class="flex min-h-32 flex-col gap-2 p-3"
			aria-label={label}
			use:dndzone={options}
			ontouchstartcapture={beginTap}
			{onconsider}
			{onfinalize}
		>
			{#each items as issue (issue.id)}
				<!--
					The dnd action assigns role="listitem" and the tabindex at runtime, and Space is
					reserved as the drag trigger (set on the board page), leaving Enter free to open.

					No resting shadow: the card is in flow, so border and the column's recess are what
					separate it (DESIGN.md, the Depth Means Floating Rule). The `shadow-xs` it once
					carried was the one in-flow shadow in the product, recorded there as drift.
				-->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					animate:flip={{ duration: options.flipDurationMs }}
					data-issue-id={issue.id}
					aria-label={issue.title}
					class="bg-card focus-visible:ring-ring hover:border-foreground/20 relative isolate flex cursor-pointer flex-col gap-2 rounded-lg border p-2.5 transition-colors outline-none focus-visible:ring-2"
					onclick={() => open(issue.id)}
					onkeydown={(event) => {
						if (event.key !== 'Enter') return;
						event.preventDefault();
						open(issue.id);
					}}
				>
					<!-- A non-focusable span, so the card still contains nothing a drag could strand
					     focus on; `relative isolate` above layers it between the card's fill and its
					     text, the same as on a list row. -->
					<RemoteTrace change={remote?.get(issue.id)} />
					<span class="line-clamp-3 text-sm">{issue.title}</span>
					<div class="flex items-center gap-2">
						<StatusBadge value={issue.status} showLabel={false} />
						<PriorityBadge value={issue.priority} showLabel={false} />
						<!-- Who left the trace, in the footer's free space so the card does not reflow. -->
						<RemoteTraceAuthor change={remote?.get(issue.id)} />
						{#if issue.labels.length > 0}
							<div class="ml-auto flex gap-1 overflow-hidden">
								{#each issue.labels.slice(0, 2) as label (label)}
									<Badge variant="secondary" class="shrink-0 text-xs">{label}</Badge>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>

	{#if total > items.length}
		<p class="text-muted-foreground border-t px-3 py-2 text-xs">
			Showing the first {items.length}. Use the list view to work through all {total}.
		</p>
	{/if}
</section>
