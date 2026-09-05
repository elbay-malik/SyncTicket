<script lang="ts">
	import {
		ISSUE_PRIORITIES,
		PRIORITY_META,
		isIssuePriority,
		type IssuePriority
	} from '$lib/model/issue.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { cn } from '$lib/utils.js';
	import PriorityBadge from './priority-badge.svelte';
	import { PRIORITY_UI } from './meta.js';

	let {
		value,
		onchange,
		showLabel = false,
		class: className
	}: {
		value: IssuePriority;
		/** Called with the newly chosen priority (never with the current one). */
		onchange: (priority: IssuePriority) => void;
		showLabel?: boolean;
		class?: string;
	} = $props();

	const label = $derived(PRIORITY_META[value].label);

	function select(next: string) {
		if (isIssuePriority(next) && next !== value) onchange(next);
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				size={showLabel ? 'sm' : 'icon-sm'}
				class={cn('font-normal', className)}
				aria-label="Priority: {label}"
				data-testid="priority-picker"
			>
				<PriorityBadge {value} {showLabel} />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="start" class="min-w-44">
		<DropdownMenu.RadioGroup {value} onValueChange={select}>
			{#each ISSUE_PRIORITIES as priority (priority)}
				{@const ui = PRIORITY_UI[priority]}
				<DropdownMenu.RadioItem value={priority}>
					<ui.icon class={cn('size-4', ui.class)} aria-hidden="true" />
					{PRIORITY_META[priority].label}
				</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>
	</DropdownMenu.Content>
</DropdownMenu.Root>
