<script lang="ts" module>
	import { setKeyboardDragTrigger } from 'svelte-dnd-action';

	// Space starts and ends a keyboard drag, which leaves Enter free to open the focused card.
	// Global to the library and set once when this route's module loads.
	setKeyboardDragTrigger('space');
</script>

<script lang="ts">
	// The board owns the drag preview for *every* column rather than each column owning its
	// own. A drag touches several columns and does not end tidily in each of them: a keyboard
	// drop reports through `consider`, not `finalize`, and a column the pointer merely passed
	// through gets an "entered" event and no closing event at all. A column holding its own
	// draft would keep showing a stale snapshot and silently stop tracking the CRDT, so the
	// board clears all previews whenever any drag ends.

	import { onDestroy, tick } from 'svelte';
	import { TRIGGERS, type DndEvent } from 'svelte-dnd-action';
	import { ISSUE_STATUSES, type Issue, type IssueStatus } from '$lib/model/issue.js';
	import { shortcuts } from '$lib/keyboard/registry.svelte.js';
	import { getIssueStore } from '$lib/state/issues.svelte.js';
	import { IssueQuery } from '$lib/state/queries.svelte.js';
	import BoardColumn from '$lib/components/issues/board-column.svelte';
	import RemoteNotice from '$lib/components/presence/remote-notice.svelte';
	import ViewBoundary from '$lib/components/shell/view-boundary.svelte';
	import {
		columnView,
		reduceConsider,
		reduceFinalize,
		type DragOutcome
	} from '$lib/components/issues/board-drag.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';

	const store = getIssueStore();
	const query = new IssueQuery(store);

	/** Per-column drag previews. Empty means "no drag in flight; render the projection". */
	let previews = $state<Partial<Record<IssueStatus, Issue[]>>>({});

	/** Each column capped to what it renders, plus the ids ordered behind the cap. */
	const columns = $derived(
		Object.fromEntries(
			ISSUE_STATUSES.map((status) => [status, columnView(query.byStatus[status])])
		) as Record<IssueStatus, ReturnType<typeof columnView>>
	);

	// The library leaves focus on <body> after a keyboard drop, which would send the next Tab
	// back to the top of the page.
	async function refocus(id: string) {
		await tick();
		document.querySelector<HTMLElement>(`[data-issue-id="${CSS.escape(id)}"]`)?.focus();
	}

	// Leaving the board mid-drag would otherwise strand the suspension and kill every
	// shortcut app-wide.
	onDestroy(() => shortcuts.setSuspended(false));

	function apply(outcome: DragOutcome) {
		if (outcome.kind === 'preview') {
			// A keyboard drag is driven by arrows and Tab, and the user still has a card picked
			// up. A stray `c` or `b` would open a dialog or navigate away mid-gesture, so global
			// shortcuts stand down until the drag ends.
			shortcuts.setSuspended(true);
			previews = { ...previews, [outcome.status]: outcome.items };
			return;
		}
		shortcuts.setSuspended(false);
		if (outcome.kind === 'commit') {
			// The cards behind the cap are not rendered but still order the column: without
			// them a drop at the bottom of a capped column would sort after the whole column
			// rather than in front of the first card the user cannot see.
			const hidden = columns[outcome.status].hiddenIds.filter((id: string) => id !== outcome.id);
			store.move(outcome.id, outcome.status, [...outcome.orderedIds, ...hidden]);
			if (outcome.source === 'keyboard') void refocus(outcome.id);
		}
		// Any ending clears every column, not just this one: a drag the pointer merely passed
		// through gets no closing event of its own and would keep showing a stale preview.
		previews = {};
	}

	function onconsider(status: IssueStatus, event: CustomEvent<DndEvent<Issue>>) {
		apply(reduceConsider(status, event.detail));
	}

	/**
	 * Set for a moment after a card was released outside every column. The library puts it
	 * back where it came from, which is right, but it did so without a word, and a visitor
	 * took the card jumping back for dragging being broken.
	 */
	let missed = $state(false);
	const MISSED_DROP =
		'That was outside every column, so the card stayed put. Release it over a column.';
	let missedTimer: ReturnType<typeof setTimeout> | undefined;
	onDestroy(() => clearTimeout(missedTimer));

	function onfinalize(status: IssueStatus, event: CustomEvent<DndEvent<Issue>>) {
		if (event.detail.info.trigger === TRIGGERS.DROPPED_OUTSIDE_OF_ANY) {
			clearTimeout(missedTimer);
			// Cleared first, so a second miss while the message is still up changes the live
			// region's text again and is announced again, rather than writing the same words.
			missed = false;
			void tick().then(() => {
				missed = true;
				missedTimer = setTimeout(() => (missed = false), 4000);
			});
		} else {
			missed = false;
		}
		apply(reduceFinalize(status, event.detail));
	}
</script>

<svelte:head>
	<title>Board · SyncTicket</title>
</svelte:head>

<div class="flex h-full flex-col gap-4">
	<!-- flex-wrap, not a fixed row: the hint is laid out at its full length first, and where it
	     does not fit beside the title it takes a line of its own at the full width, instead of
	     being squeezed into a narrow ragged column right of "Board" (768px, sidebar docked). -->
	<div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
		<h1 class="text-lg font-semibold tracking-tight">Board</h1>
		<!-- The hold is not decoration: a touch only becomes a drag after
		     board-column.svelte's TOUCH_DRAG_DELAY_MS, so that a swipe which starts on a card
		     scrolls the board instead of dragging the card. -->
		<!-- One line, two texts: the hint, or for a moment after a missed drop, why the card went
		     back. The live region beside it is always in the page and only its text changes, so
		     the message is announced when it appears, and only then. -->
		<p class="text-muted-foreground ml-auto text-xs text-pretty" data-testid="board-hint">
			{#if missed}
				<span class="text-foreground font-medium">{MISSED_DROP}</span>
			{:else}
				Drag a card — on a touch screen, hold it first — or focus one and press Space, then arrow
				keys or Tab.
			{/if}
		</p>
		<span class="sr-only" role="status" data-testid="board-drop-missed">
			{missed ? MISSED_DROP : ''}
		</span>
	</div>

	{#if !query.synced}
		<div class="flex gap-4" data-testid="board-loading">
			{#each ISSUE_STATUSES as status (status)}
				<Skeleton class="h-64 w-72 shrink-0" />
			{/each}
		</div>
	{:else}
		<ViewBoundary
			title="The board couldn’t be shown"
			class="min-h-[40vh] rounded-lg border border-dashed p-12"
		>
			<!-- The one horizontal scroller on the route. It only gets to be one because the inset
			     around <main> may shrink below the columns' width (sidebar-inset.svelte's min-w-0);
			     the test id lets board.e2e.ts assert that the overflow lands here, not on the page. -->
			<!-- Out to the edges of <main>, through its padding (`-mx-6 px-6`, matching its p-6): on a
			     phone the next column only shows at the screen's edge, and that strip used to be
			     padding outside the scroller, where a card released over it belonged to no column. -->
			<div
				class="-mx-6 flex min-h-64 flex-1 gap-4 overflow-x-auto px-6 pb-4"
				data-testid="board-columns"
			>
				{#each ISSUE_STATUSES as status (status)}
					<BoardColumn
						{status}
						items={previews[status] ?? columns[status].visible}
						total={columns[status].total}
						onconsider={(event) => onconsider(status, event)}
						onfinalize={(event) => onfinalize(status, event)}
						remote={store.remote}
					/>
				{/each}
			</div>
			<!-- Every issue has a column here, so only a deletion lacks a place; a card past its
			     column's cap is never rendered and counts as off-screen. -->
			<RemoteNotice
				activity={store.remote}
				listed={(id) => store.get(id) !== undefined}
				find={(id) => document.querySelector<HTMLElement>(`[data-issue-id="${CSS.escape(id)}"]`)}
			/>
		</ViewBoundary>
	{/if}
</div>
