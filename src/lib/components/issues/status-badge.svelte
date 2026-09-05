<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { STATUS_META, type IssueStatus } from '$lib/model/issue.js';
	import { cn } from '$lib/utils.js';
	import { STATUS_UI } from './meta.js';

	let {
		value,
		showLabel = true,
		class: className,
		...restProps
	}: HTMLAttributes<HTMLSpanElement> & {
		value: IssueStatus;
		showLabel?: boolean;
	} = $props();

	const ui = $derived(STATUS_UI[value]);
	const label = $derived(STATUS_META[value].label);
</script>

<span
	data-slot="status-badge"
	data-status={value}
	class={cn('inline-flex items-center gap-1.5 text-sm', className)}
	role={showLabel ? undefined : 'img'}
	title={showLabel ? undefined : label}
	aria-label={showLabel ? undefined : label}
	{...restProps}
>
	<ui.icon class={cn('size-4 shrink-0', ui.class)} aria-hidden="true" />
	{#if showLabel}
		<span class="truncate">{label}</span>
	{/if}
</span>
