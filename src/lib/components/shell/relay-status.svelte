<script lang="ts">
	// What is true about this workspace, in two sentences: where the data lives, and who
	// else currently has it. The two vary independently — a browser that failed to open its
	// database can still talk to a relay perfectly well (the edits just won't survive a
	// reload), and a browser cut off from the relay has still saved everything locally — so
	// this never collapses them into one icon's worth of meaning.
	//
	// A popover rather than a tooltip: the sentences carry real information (persistence can
	// fail; sharing has five distinct states), which deserves to be read at leisure rather
	// than caught in the half-second before a tooltip vanishes.

	import CloudIcon from '@lucide/svelte/icons/cloud';
	import CloudOffIcon from '@lucide/svelte/icons/cloud-off';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { connectionCopy } from '$lib/format.js';
	import type { IssueStore } from '$lib/state/issues.svelte.js';
	import type { Presence } from '$lib/state/presence.svelte.js';
	import * as Popover from '$lib/components/ui/popover/index.js';

	let { store, presence }: { store: IssueStore; presence: Presence } = $props();

	const copy = $derived(
		connectionCopy({
			persisted: store.persisted,
			connection: store.connection,
			relaySynced: store.relaySynced,
			peerCount: presence.peers.length
		})
	);

	const label = $derived(`${copy.stored}. ${copy.shared}.`);

	// Announced only on the debounced (never the raw, flapping) transition into or out of
	// 'offline' — going offline is a fact worth interrupting for, once it is actually true,
	// unlike presence's continuous comings and goings (ADR 0007), which stays off aria-live
	// entirely. 'local' never reaches here: it is not a problem, so it is never announced.
	let announcedOffline = $state(false);
	let liveMessage = $state('');
	$effect(() => {
		const isOffline = store.connection === 'offline';
		if (isOffline === announcedOffline) return;
		announcedOffline = isOffline;
		liveMessage = isOffline
			? store.persisted
				? "You're offline. Your changes are saved on this device and will sync once you're back online."
				: "You're offline, and this browser could not save locally either — changes here will be lost if this tab closes."
			: 'Back online.';
	});
</script>

<Popover.Root>
	<Popover.Trigger
		data-testid="relay-status"
		data-connection={store.connection}
		data-synced={store.relaySynced}
		aria-label={label}
		class="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs transition-colors"
	>
		{#if store.connection === 'connected'}
			<CloudIcon class="size-3.5" aria-hidden="true" />
		{:else if store.connection === 'connecting'}
			<RefreshCwIcon class="size-3.5 animate-spin" aria-hidden="true" />
		{:else if store.connection === 'local'}
			<HardDriveIcon class="size-3.5" aria-hidden="true" />
		{:else}
			<CloudOffIcon class="size-3.5" aria-hidden="true" />
		{/if}
	</Popover.Trigger>
	<Popover.Content
		role="dialog"
		aria-label="Connection status"
		data-testid="connection-details"
		class="w-72 text-sm"
	>
		<div class="flex items-start gap-2">
			<HardDriveIcon class="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
			<p data-testid="connection-stored" class:text-destructive={!store.persisted} class="flex-1">
				{copy.stored}
			</p>
		</div>
		<div class="flex items-start gap-2">
			{#if store.connection === 'connected'}
				<CloudIcon class="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
			{:else if store.connection === 'connecting'}
				<RefreshCwIcon
					class="text-muted-foreground mt-0.5 size-4 shrink-0 animate-spin"
					aria-hidden="true"
				/>
			{:else if store.connection === 'local'}
				<HardDriveIcon class="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
			{:else}
				<CloudOffIcon class="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
			{/if}
			<p data-testid="connection-shared" class="flex-1">{copy.shared}</p>
		</div>
	</Popover.Content>
</Popover.Root>

<span class="sr-only" role="status" aria-live="polite">{liveMessage}</span>
