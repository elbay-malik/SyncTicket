<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { ModeWatcher } from 'mode-watcher';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import AppSidebar from '$lib/components/shell/app-sidebar.svelte';
	import CommandMenu from '$lib/components/shell/command-menu.svelte';
	import ThemeToggle from '$lib/components/shell/theme-toggle.svelte';
	import IssueCreateDialog from '$lib/components/issues/issue-create-dialog.svelte';
	import ShortcutsHelp from '$lib/components/shell/shortcuts-help.svelte';
	import { isApple } from '$lib/keyboard/keys.js';
	import { shortcuts } from '$lib/keyboard/registry.svelte.js';
	import { getIssueStore } from '$lib/state/issues.svelte.js';
	import { issueUi } from '$lib/state/ui.svelte.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';

	let { children } = $props();

	// One keydown listener for the whole app; every shortcut is declared in the registry so
	// the palette and the help sheet can show what actually exists (src/lib/keyboard).
	//
	// Deliberately absent from the registry: Enter and the arrow keys. A document-level
	// handler that preventDefaults them would suppress button activation, link navigation
	// and form submission everywhere, and would fight the list's own cursor. Those belong to
	// the widget that has focus.
	const store = getIssueStore();

	let helpOpen = $state(false);

	onMount(() => {
		shortcuts.setApple(isApple(navigator.platform || navigator.userAgent));
		const off = [
			shortcuts.register({
				id: 'palette',
				chord: 'mod+k',
				label: 'Command palette',
				group: 'Navigation',
				// The palette's own input is a combobox inside a dialog, so without both of these
				// the shortcut could open the palette but never close it again.
				allowInInput: true,
				allowInOverlay: true,
				run: () => (issueUi.paletteOpen = !issueUi.paletteOpen)
			}),
			shortcuts.register({
				id: 'new-issue',
				chord: 'c',
				label: 'New issue',
				group: 'Issues',
				run: () => (issueUi.createOpen = true)
			}),
			shortcuts.register({
				id: 'go-issues',
				chord: 'i',
				label: 'Go to issues',
				group: 'Navigation',
				run: () => void goto(resolve('/issues'))
			}),
			shortcuts.register({
				id: 'go-board',
				chord: 'b',
				label: 'Go to board',
				group: 'Navigation',
				run: () => void goto(resolve('/board'))
			}),
			shortcuts.register({
				id: 'help',
				chord: '?',
				label: 'Keyboard shortcuts',
				group: 'View',
				run: () => (helpOpen = true)
			})
		];
		return () => off.forEach((unregister) => unregister());
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>SyncTicket</title>
	<meta
		name="description"
		content="A local-first, real-time collaborative issue tracker built with Svelte 5."
	/>
</svelte:head>

<svelte:document onkeydown={(event) => shortcuts.handle(event)} />

<ModeWatcher />
<CommandMenu />
<IssueCreateDialog {store} bind:open={issueUi.createOpen} />
<ShortcutsHelp bind:open={helpOpen} />

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
		<main class="min-h-0 flex-1 overflow-auto p-6">
			{@render children()}
		</main>
	</Sidebar.Inset>
</Sidebar.Provider>
