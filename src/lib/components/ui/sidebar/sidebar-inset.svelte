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

	`min-w-0`, which upstream also lacks, is what keeps a wide route inside the shell. The
	inset is a flex item sized `w-full` — 100% of the wrapper — beside the docked sidebar's
	256px gap, so it has to shrink to fit. A flex item's default `min-width: auto` forbids that
	whenever its min-content is at least its specified width, and the board's five fixed
	columns (1504px) are: a scroll container's content still counts towards its parent's
	min-content. The inset stayed a full viewport wide and the *document* scrolled sideways by
	exactly the sidebar's width — 1536 at 1280, with the header's Share, Undo and theme toggle
	off-screen. Below md the sidebar is a sheet with no gap, which is why 320px never showed
	it. With the floor at zero the inset takes what is left and the board scrolls inside
	<main>, where its columns are meant to scroll as a set (e2e/board.e2e.ts asserts it).
-->
<div
	bind:this={ref}
	data-slot="sidebar-inset"
	class={cn(
		'bg-background md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2 relative flex w-full min-w-0 flex-1 flex-col',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
