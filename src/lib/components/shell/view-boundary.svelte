<script lang="ts">
	// What a view shows instead of taking the page down when something inside it throws while
	// rendering. Without one, an error in a block or an effect escapes the flush and every later
	// update on the page stops, and a peer's data can make that happen on every load.
	//
	// Svelte destroys the failed subtree at once and runs `onerror` and `failed` a microtask later.
	// It catches rendering and effects only, so a throw in an event handler or a timer never
	// comes here. `failed` is plain page content and adds no element around the children, so
	// layout and the Virtualizer's parent are untouched, and focus inside the subtree falls to
	// <body> with the browser's Tab position left where it was, so the next Tab reaches the retry.
	//
	// Not on the server path today: all three views sit behind `store.synced`, which is still false
	// when a Worker render finishes. If one ever gets here it only passes its children through, and
	// a throw is not caught: SvelteKit hands Svelte a `transformError` only under its experimental
	// `handleRenderingErrors`, which is off here, and without one svelte/server rethrows. The request
	// fails as it always did.

	import type { Snippet } from 'svelte';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '$lib/components/ui/button/index.js';

	let {
		title,
		class: className = '',
		children
	}: {
		/** Names the view that could not be shown. */
		title: string;
		class?: string;
		children: Snippet;
	} = $props();

	function onerror(error: unknown) {
		console.error(`[view] ${title}`, error);
	}
</script>

<svelte:boundary {onerror}>
	{@render children()}

	<!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -- `reset` is the second parameter -->
	{#snippet failed(_error, reset)}
		<div
			class="flex flex-col items-center justify-center gap-3 text-center {className}"
			role="status"
			data-testid="view-failed"
		>
			<TriangleAlertIcon class="text-muted-foreground size-8" />
			<p class="text-base font-medium">{title}</p>
			<p class="text-muted-foreground max-w-sm text-sm">
				Something in this workspace stopped it from rendering. Nothing saved has changed.
			</p>
			<Button variant="outline" size="sm" onclick={() => reset()}>Try again</Button>
		</div>
	{/snippet}
</svelte:boundary>
