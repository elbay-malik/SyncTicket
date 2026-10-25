<script lang="ts">
	// Who is in this workspace, and the way to change what they call you.
	//
	// One control rather than a stack plus a separate settings button: the avatars are
	// aria-hidden decoration, and the button carries the whole sentence as its accessible
	// name, so a screen reader gets "You are Ada Lovelace. Grace Hopper is also here.
	// Change your display name." instead of a row of unlabelled swatches.

	import { onMount } from 'svelte';
	import { MAX_NAME_LENGTH, initialsOf } from '$lib/model/identity.js';
	import { listNames } from '$lib/format.js';
	import type { Presence } from '$lib/state/presence.svelte.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import PeerAvatars from './peer-avatars.svelte';
	import RemoteAnnouncer from './remote-announcer.svelte';

	let { presence }: { presence: Presence } = $props();

	let open = $state(false);
	let draft = $state('');

	// Rendered only after mounting, because who you are is a fact about this browser. The
	// server has no localStorage, so it would render a freshly invented name and the client
	// would immediately replace it with the remembered one — a hydration mismatch, and a
	// visible flash of somebody else's name in the header.
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});

	// People, not tabs: your own other tabs are you, and are said as such rather than named
	// back to you as company.
	const others = $derived(presence.others.map((peer) => peer.name));
	const tabs = $derived(
		presence.myOtherTabs === 0
			? ''
			: ` You also have it open in ${presence.myOtherTabs === 1 ? 'another tab' : `${presence.myOtherTabs} other tabs`}.`
	);
	const label = $derived(
		others.length === 0
			? `You are ${presence.me.name}.${tabs} Nobody else is here. Change your display name.`
			: `You are ${presence.me.name}.${tabs} ${listNames(others)} ${
					others.length === 1 ? 'is' : 'are'
				} also here. Change your display name.`
	);

	function openDialog() {
		draft = presence.me.name;
		open = true;
	}

	function save(event: SubmitEvent) {
		event.preventDefault();
		presence.rename(draft);
		open = false;
	}
</script>

<!-- Outside the `mounted` gate: the region has to exist, empty, before its first message.
     The header is on every route, so peers' changes are announced wherever this user is. -->
{#if presence.activity}<RemoteAnnouncer activity={presence.activity} />{/if}

{#if mounted}
	<button
		type="button"
		onclick={openDialog}
		data-testid="presence-bar"
		data-peer-count={presence.everyone.length}
		aria-label={label}
		class="focus-visible:ring-ring flex items-center rounded-full outline-none focus-visible:ring-2"
	>
		<!-- `everyone`, not `peers`: seeing your own colour is how you know which avatar is
		     yours on the issue you have open. -->
		<PeerAvatars peers={presence.everyone} summary="" testId="presence-peers" />
	</button>
{:else}
	<!-- Holds the space so the header does not jump when the avatars arrive. -->
	<span class="size-6" aria-hidden="true"></span>
{/if}

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Your display name</Dialog.Title>
			<Dialog.Description>
				This is what other people in this workspace see. It is stored in your browser and proves
				nothing about who you are.
			</Dialog.Description>
		</Dialog.Header>
		<form onsubmit={save} class="grid gap-4">
			<div class="grid gap-2">
				<Label for="presence-name">Name</Label>
				<div class="flex items-center gap-2">
					<span class="peer-avatar" style="--peer-h: {presence.me.hue}" aria-hidden="true">
						{initialsOf(draft.trim() || presence.me.name)}
					</span>
					<Input
						id="presence-name"
						bind:value={draft}
						maxlength={MAX_NAME_LENGTH}
						autocomplete="off"
						placeholder={presence.me.name}
					/>
				</div>
			</div>
			<Dialog.Footer>
				<Button type="submit">Save</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
