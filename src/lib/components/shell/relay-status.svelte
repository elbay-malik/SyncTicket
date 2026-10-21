<script lang="ts">
	// What is true about this workspace, in two sentences: where the data lives, and who
	// else currently has it — plus a third when the relay has stopped saving it on the
	// server. All three vary independently — a browser that failed to open its database can
	// still talk to a relay perfectly well (the edits just won't survive a reload), a browser
	// cut off from the relay has still saved everything locally, and a relay whose own writes
	// are failing still has a healthy socket — so this never collapses them into one icon's
	// worth of meaning.
	//
	// A popover rather than a tooltip: the sentences carry real information (persistence can
	// fail; sharing has five distinct states), which deserves to be read at leisure rather
	// than caught in the half-second before a tooltip vanishes.

	import CloudIcon from '@lucide/svelte/icons/cloud';
	import CloudOffIcon from '@lucide/svelte/icons/cloud-off';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
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
			peerCount: presence.peers.length,
			relayPersistence: store.relayPersistence,
			relayPersistenceReason: store.relayPersistenceReason
		})
	);

	const label = $derived(
		`${copy.stored}. ${copy.shared}.${copy.durable ? ` ${copy.durable}` : ''}`
	);

	// Announced only on the debounced (never the raw, flapping) transition into or out of
	// 'offline' — going offline is a fact worth interrupting for, once it is actually true,
	// unlike presence's continuous comings and goings (ADR 0007), which stays off aria-live
	// entirely. 'local' never reaches here: it is not a problem, so it is never announced.
	//
	// The server-side persistence failure is NOT announced from here — see the note inside the
	// effect. It reaches assistive tech through the /issues banner's own `role="status"` and
	// through this trigger's `aria-label`.
	let announcedOffline = $state(false);
	let liveMessage = $state('');
	$effect(() => {
		const isOffline = store.connection === 'offline';
		// Persistence is deliberately NOT announced here. The banner on /issues carries the
		// same sentence in a `role="status"` region, so announcing it from this sr-only region
		// too would read it twice, from two live regions, in an order neither controls — and
		// the invalid-`?ws=` banner established the precedent that a route-level notice does
		// not get an sr-only twin. The trigger's `aria-label` still carries the fact for
		// anyone who reaches the control itself.
		if (isOffline === announcedOffline) return;
		// Recovery is announced only once the relay is genuinely back, never on a mere
		// 'connecting' — otherwise an outage's retry loop would claim "Back online" over and
		// over while nothing had connected at all.
		if (!isOffline && store.connection !== 'connected') return;
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
		data-persistence={store.relayPersistence}
		aria-label={label}
		class="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs transition-colors"
	>
		<!-- Ahead of every connection branch, replacing whichever one would have rendered
		     rather than joining them as another connection state: when the relay cannot save,
		     `connection` is literally 'connected' and the cloud icon is an active lie — the
		     socket is fine, the data is not surviving it. The header comment above is why this
		     is allowed to take the icon: persistence and sharing must not collapse into one
		     icon's worth of meaning, so an icon asserting "connected and fine" cannot stand
		     while a third independent fact contradicts it. Nothing is lost — the popover still
		     carries every sentence, and so does this trigger's aria-label, which is composed
		     from `connectionCopy` and therefore picks up the new one automatically. -->
		{#if store.relayPersistence !== 'ok'}
			<TriangleAlertIcon class="text-destructive size-3.5" aria-hidden="true" />
		{:else if store.connection === 'connected'}
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
		{#if copy.durable}
			<!-- The third independent fact: whether the relay is still writing this document to
			     its own storage. Present only when it is not, because "the server is saving" is
			     the unremarkable case and a row for it would dilute the two that always show. -->
			<div class="flex items-start gap-2">
				<HardDriveIcon class="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
				<p data-testid="connection-durable" class="flex-1 text-destructive">{copy.durable}</p>
			</div>
		{/if}
	</Popover.Content>
</Popover.Root>

<span class="sr-only" role="status" aria-live="polite">{liveMessage}</span>
