<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<!--
	A div, not the `<main>` upstream shadcn renders here. The inset is the whole right-hand
	pane — app header included — not the page's main content, so a `<main>` at this level
	leaves a consumer only bad options: nest a second `<main>` for the scrolling region, or
	put `<header>` inside `main`, where it stops being exposed as a banner landmark. The
	route layout marks the one real `<main>` itself (src/routes/+layout.svelte).
-->
<div
	bind:this={ref}
	data-slot="sidebar-inset"
	class={cn(
		'bg-background md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2 relative flex w-full flex-1 flex-col',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
