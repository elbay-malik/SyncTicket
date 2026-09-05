<script lang="ts">
	// A small, honest indicator: it distinguishes "connected" (the socket is open) from
	// "synced" (this client and the relay have actually exchanged state), because only the
	// second means what a user would take "in sync" to mean. Phase 11 gives it real UI.

	import CloudIcon from '@lucide/svelte/icons/cloud';
	import CloudOffIcon from '@lucide/svelte/icons/cloud-off';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import type { IssueStore } from '$lib/state/issues.svelte.js';

	let { store }: { store: IssueStore } = $props();

	const label = $derived(
		store.connection === 'connected'
			? store.relaySynced
				? 'Synced with collaborators'
				: 'Connected, syncing…'
			: store.connection === 'connecting'
				? 'Connecting…'
				: 'Working offline'
	);
</script>

<span
	data-testid="relay-status"
	data-connection={store.connection}
	data-synced={store.relaySynced}
	class="text-muted-foreground flex items-center gap-1.5 text-xs"
	title={label}
>
	{#if store.connection === 'connected'}
		<CloudIcon class="size-3.5" aria-hidden="true" />
	{:else if store.connection === 'connecting'}
		<RefreshCwIcon class="size-3.5 animate-spin" aria-hidden="true" />
	{:else}
		<CloudOffIcon class="size-3.5" aria-hidden="true" />
	{/if}
	<span class="sr-only">{label}</span>
</span>
