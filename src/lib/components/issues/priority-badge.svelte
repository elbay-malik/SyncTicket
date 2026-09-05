<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { PRIORITY_META, type IssuePriority } from '$lib/model/issue.js';
	import { cn } from '$lib/utils.js';
	import { PRIORITY_UI } from './meta.js';

	let {
		value,
		showLabel = true,
		class: className,
		...restProps
	}: HTMLAttributes<HTMLSpanElement> & {
		value: IssuePriority;
		showLabel?: boolean;
	} = $props();

	const ui = $derived(PRIORITY_UI[value]);
	const label = $derived(PRIORITY_META[value].label);
</script>

<span
	data-slot="priority-badge"
	data-priority={value}
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
