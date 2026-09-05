<script lang="ts">
	import {
		ISSUE_STATUSES,
		STATUS_META,
		isIssueStatus,
		type IssueStatus
	} from '$lib/model/issue.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { cn } from '$lib/utils.js';
	import StatusBadge from './status-badge.svelte';
	import { STATUS_UI } from './meta.js';

	let {
		value,
		onchange,
		showLabel = false,
		class: className
	}: {
		value: IssueStatus;
		/** Called with the newly chosen status (never with the current one). */
		onchange: (status: IssueStatus) => void;
		showLabel?: boolean;
		class?: string;
	} = $props();

	const label = $derived(STATUS_META[value].label);

	function select(next: string) {
		if (isIssueStatus(next) && next !== value) onchange(next);
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
				aria-label="Status: {label}"
				data-testid="status-picker"
			>
				<StatusBadge {value} {showLabel} />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="start" class="min-w-44">
		<DropdownMenu.RadioGroup {value} onValueChange={select}>
			{#each ISSUE_STATUSES as status (status)}
				{@const ui = STATUS_UI[status]}
				<DropdownMenu.RadioItem value={status}>
					<ui.icon class={cn('size-4', ui.class)} aria-hidden="true" />
					{STATUS_META[status].label}
				</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>
	</DropdownMenu.Content>
</DropdownMenu.Root>
