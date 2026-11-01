<script lang="ts">
	// Stands in for the UI Label, which among the sheet's contents only the editor renders, so the
	// editor can be made to throw while the list behind it is left alone.
	import type { Snippet } from 'svelte';
	import { trap } from './view-boundary.trace-trap.fixture.svelte';

	let {
		children,
		for: htmlFor,
		class: className
	}: { children?: Snippet; for?: string; class?: string } = $props();
	const keys = $derived(trap.editor ? ['boom', 'boom'] : ['ok']);
</script>

<label for={htmlFor} class={className}>{@render children?.()}</label>
{#each keys as key (key)}
	<span hidden>{key}</span>
{/each}
