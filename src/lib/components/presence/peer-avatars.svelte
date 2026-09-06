<script lang="ts">
	// An avatar stack, built so the avatars themselves are decoration.
	//
	// Colour is never the only channel: every avatar carries the peer's initials, and the
	// whole stack is summarised in one visually-hidden sentence. Nine hues at a single
	// lightness are not distinguishable for a colour-blind user, and a stack of N labelled
	// images would make a list row announce as a list of swatches — so the images are hidden
	// and the sentence is what a screen reader reads.
	//
	// Not a live region. Presence changes whenever anyone opens or closes an issue, and an
	// announcement each time would talk over whatever the user was actually doing.

	import { initialsOf } from '$lib/model/identity.js';
	import { listNames } from '$lib/format.js';
	import type { Peer } from '$lib/state/presence.svelte.js';

	let {
		peers,
		max = 3,
		size = 'md',
		summary,
		testId
	}: {
		peers: readonly Peer[];
		/** How many faces to draw before collapsing the rest into a "+N" chip. */
		max?: number;
		size?: 'sm' | 'md';
		/**
		 * The sentence a screen reader gets. Defaults to naming everyone in the stack; pass
		 * an empty string when an ancestor already carries the label, so the name is not
		 * announced twice.
		 */
		summary?: string;
		testId?: string;
	} = $props();

	const shown = $derived(peers.slice(0, max));
	const overflow = $derived(peers.length - shown.length);
	const sentence = $derived(
		summary ??
			listNames(
				peers.map((peer) => peer.name),
				max
			)
	);
</script>

{#if peers.length > 0}
	<span class="flex shrink-0 items-center -space-x-1" data-testid={testId}>
		{#each shown as peer (peer.userId)}
			<!--
				Keyed by userId, not by Yjs client id: the same person in two tabs is one avatar,
				and reloading a tab must not remount it.
			-->
			<span
				class="peer-avatar"
				class:peer-avatar-sm={size === 'sm'}
				style="--peer-h: {peer.hue}"
				data-peer={peer.name}
				aria-hidden="true"
			>
				{initialsOf(peer.name)}
			</span>
		{/each}
		{#if overflow > 0}
			<span
				class="peer-avatar peer-avatar-more"
				class:peer-avatar-sm={size === 'sm'}
				aria-hidden="true"
			>
				+{overflow}
			</span>
		{/if}
		{#if sentence}<span class="sr-only">{sentence}</span>{/if}
	</span>
{/if}
