<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { ModeWatcher } from 'mode-watcher';
	import AppSidebar from '$lib/components/shell/app-sidebar.svelte';
	import CommandMenu from '$lib/components/shell/command-menu.svelte';
	import ThemeToggle from '$lib/components/shell/theme-toggle.svelte';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>SyncTicket</title>
	<meta
		name="description"
		content="A local-first, real-time collaborative issue tracker built with Svelte 5."
	/>
</svelte:head>

<ModeWatcher />
<CommandMenu />

<Sidebar.Provider>
	<AppSidebar />
	<Sidebar.Inset>
		<header class="flex h-12 shrink-0 items-center gap-2 border-b px-4">
			<Sidebar.Trigger />
			<Separator orientation="vertical" class="data-[orientation=vertical]:h-4" />
			<span class="text-sm font-medium">SyncTicket</span>
			<div class="ml-auto flex items-center gap-1">
				<ThemeToggle />
			</div>
		</header>
		<main class="flex-1 overflow-auto p-6">
			{@render children()}
		</main>
	</Sidebar.Inset>
</Sidebar.Provider>
