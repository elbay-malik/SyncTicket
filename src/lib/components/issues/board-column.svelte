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
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { STATUS_META, type Issue, type IssueStatus } from '$lib/model/issue.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import PriorityBadge from './priority-badge.svelte';
	import StatusBadge from './status-badge.svelte';
	import { STATUS_UI } from './meta.js';

	let {
		status,
		items,
		total = items.length,
		flipDurationMs = 150,
		onconsider,
		onfinalize
	}: {
		status: IssueStatus;
		/** Already resolved by the board: the drag preview when one is in flight, else live. */
		items: Issue[];
		/** Issues in this status overall; larger than `items` once the render cap applies. */
		total?: number;
		flipDurationMs?: number;
		onconsider: (event: CustomEvent<DndEvent<Issue>>) => void;
		onfinalize: (event: CustomEvent<DndEvent<Issue>>) => void;
	} = $props();

	const ui = $derived(STATUS_UI[status]);
	const label = $derived(STATUS_META[status].label);

	function open(id: string) {
		void goto(resolve('/issues/[id]', { id }));
	}
</script>

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
		<!--
			zoneTabIndex -1 keeps the five columns out of the idle tab order; the library still
			raises it to 0 for eligible target zones while a drag runs, which is what makes
			Tab-to-another-column work.
		-->
		<div
			class="flex min-h-32 flex-col gap-2 p-3"
			aria-label={label}
			use:dndzone={{ items, type: 'issues', flipDurationMs, zoneTabIndex: -1 }}
			{onconsider}
			{onfinalize}
		>
			{#each items as issue (issue.id)}
				<!--
					The dnd action assigns role="listitem" and the tabindex at runtime, and Space is
					reserved as the drag trigger (set on the board page), leaving Enter free to open.
				-->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					animate:flip={{ duration: flipDurationMs }}
					data-issue-id={issue.id}
					aria-label={issue.title}
					class="bg-card focus-visible:ring-ring hover:border-foreground/20 flex cursor-pointer flex-col gap-2 rounded-lg border p-2.5 shadow-xs transition-colors outline-none focus-visible:ring-2"
					onclick={() => open(issue.id)}
					onkeydown={(event) => {
						if (event.key !== 'Enter') return;
						event.preventDefault();
						open(issue.id);
					}}
				>
					<span class="line-clamp-3 text-sm">{issue.title}</span>
					<div class="flex items-center gap-2">
						<StatusBadge value={issue.status} showLabel={false} />
						<PriorityBadge value={issue.priority} showLabel={false} />
						{#if issue.labels.length > 0}
							<div class="ml-auto flex gap-1 overflow-hidden">
								{#each issue.labels.slice(0, 2) as label (label)}
									<Badge variant="secondary" class="shrink-0 text-[10px]">{label}</Badge>
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
