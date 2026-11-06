<script lang="ts">
	// What a route shows when it cannot render: an address that matches nothing, or a page
	// whose code could not be fetched. Without this file SvelteKit rendered a bare, unstyled
	// "500 Internal Error". The shell around it still works, and so does the data, so the page
	// says so and offers the way back.
	//
	// A chunk that failed to load stays failed for the life of the document (Chromium keeps the
	// rejected import), so coming back online is not enough: only a reload fetches it again.
	// Reloading offline would replace the app with the browser's own error page, so the button
	// waits for the network.

	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ListTodoIcon from '@lucide/svelte/icons/list-todo';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '$lib/components/ui/button/index.js';

	let online = $state(true);

	onMount(() => {
		online = navigator.onLine;
		const update = () => (online = navigator.onLine);
		window.addEventListener('online', update);
		window.addEventListener('offline', update);
		return () => {
			window.removeEventListener('online', update);
			window.removeEventListener('offline', update);
		};
	});

	const notFound = $derived(page.status === 404);
</script>

<svelte:head>
	<title>{notFound ? 'Page not found' : 'Page did not load'} · SyncTicket</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-6">
	<div
		class="flex min-h-[40vh] flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-12 text-center"
		data-testid="route-error"
		data-status={page.status}
	>
		<TriangleAlertIcon class="text-muted-foreground size-8" />
		{#if notFound}
			<h1 class="text-base font-medium">Page not found</h1>
			<p class="text-muted-foreground max-w-sm text-sm">
				There's nothing at this address. Your issues are where you left them.
			</p>
		{:else}
			<h1 class="text-base font-medium">This page didn't load</h1>
			<p class="text-muted-foreground max-w-sm text-sm">
				{#if online}
					Something went wrong while loading it. Your issues are safe on this device, and reloading
					usually fixes this.
				{:else}
					You're offline, and this page wasn't downloaded before the connection dropped. Your issues
					are safe on this device, and the Issues page still works.
				{/if}
			</p>
		{/if}
		<div class="flex flex-wrap items-center justify-center gap-2">
			<Button size="sm" href={resolve('/issues')}>
				<ListTodoIcon />
				Go to Issues
			</Button>
			{#if !notFound}
				<Button size="sm" variant="outline" disabled={!online} onclick={() => location.reload()}>
					<RotateCwIcon />
					{online ? 'Reload' : 'Reload once online'}
				</Button>
			{/if}
		</div>
	</div>
</div>
