<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		showOnTouch = false,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLElement>> & {
		/**
		 * Keep the chip on touch-only devices. Only for a surface whose subject IS the keys —
		 * the shortcuts sheet — where hiding them would leave labels next to nothing.
		 */
		showOnTouch?: boolean;
	} = $props();
</script>

<!--
	Hidden on touch-only devices by default. An inline hint — the "C" on New issue, ⌘K on
	Search — advertises a key the visitor does not have, and on a phone, which is where
	PRODUCT.md says evaluators often arrive, it reads as noise on the very control it decorates.
	Decided here once rather than at each call site, so a hint added later cannot forget.

	Coarse AND no hover, not coarse alone: an iPad with a trackpad reports a fine pointer, and a
	touch laptop's primary pointer is its trackpad, so both keep their hints. What is left is the
	phone or the bare tablet, where no keyboard is the overwhelmingly likely case. A hint missing
	for the rare Bluetooth-keyboard phone costs nothing; the shortcut still works.

	`whitespace-nowrap` and `shrink-0` because a chip is one key or one chord, never a sentence:
	in the shortcuts sheet at 390px a long label squeezed "← →" onto two lines inside its chip.
	Both are needed — `min-w-5` replaces a flex item's min-content floor, so without `shrink-0`
	a nowrap chip is still crushed to 20px and its chord spills out of the fill.
-->
<kbd
	bind:this={ref}
	data-slot="kbd"
	class={cn(
		"bg-muted text-muted-foreground in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 h-5 w-fit min-w-5 gap-1 rounded-sm px-1 font-sans text-xs font-medium [&_svg:not([class*='size-'])]:size-3 pointer-events-none inline-flex items-center shrink-0 justify-center whitespace-nowrap select-none",
		!showOnTouch && '[@media(pointer:coarse)_and_(hover:none)]:hidden',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</kbd>
