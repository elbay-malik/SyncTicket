<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Issue, IssuePriority, IssueStatus } from '$lib/model/issue.js';
	import type { IssueStore } from '$lib/state/issues.svelte.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import PriorityPicker from './priority-picker.svelte';
	import StatusPicker from './status-picker.svelte';

	let {
		issue,
		store,
		selected = false,
		tabbable = false
	}: { issue: Issue; store: IssueStore; selected?: boolean; tabbable?: boolean } = $props();
</script>

<!--
	The row is the *contents* of a list item, not the <li> itself: the virtualizer owns the
	item element so it can position and measure it (see issue-list.svelte).
-->
<div
	class="group hover:bg-muted/50 flex items-center gap-2 px-2 py-1.5 transition-colors"
	class:bg-muted={selected}
>
	<!-- The pickers are siblings of the link, not descendants, so their clicks never reach
	     it — no propagation guard is needed (and adding onclick after the trigger's spread
	     props would clobber bits-ui's own handler). -->
	<StatusPicker
		value={issue.status}
		onchange={(status: IssueStatus) => store.update(issue.id, { status })}
	/>

	<!--
		Roving tabindex: only the cursor row is tabbable, so Tab enters the list once and lands
		where the cursor is rather than walking every row. The anchor is also what the list
		focuses when the cursor moves, which is what makes a screen reader announce the row —
		and it keeps Enter as ordinary link activation instead of a global shortcut.
	-->
	<a
		href={resolve('/issues/[id]', { id: issue.id })}
		data-issue-link={issue.id}
		tabindex={tabbable ? 0 : -1}
		aria-current={selected ? 'true' : undefined}
		class="focus-visible:ring-ring flex-1 truncate rounded-sm px-1 py-1 text-sm outline-none focus-visible:ring-2"
	>
		{issue.title}
	</a>

	{#if issue.labels.length > 0}
		<div class="hidden shrink-0 gap-1 sm:flex">
			{#each issue.labels.slice(0, 2) as label (label)}
				<Badge variant="secondary" class="text-[10px]">{label}</Badge>
			{/each}
		</div>
	{/if}

	<PriorityPicker
		value={issue.priority}
		onchange={(priority: IssuePriority) => store.update(issue.id, { priority })}
	/>
</div>
