<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { ModeWatcher } from 'mode-watcher';
	import { page } from '$app/state';
	import AppSidebar from '$lib/components/shell/app-sidebar.svelte';
	import CommandMenu from '$lib/components/shell/command-menu.svelte';
	import ThemeToggle from '$lib/components/shell/theme-toggle.svelte';
	import IssueCreateDialog from '$lib/components/issues/issue-create-dialog.svelte';
	import { getIssueStore } from '$lib/state/issues.svelte.js';
	import { issueUi } from '$lib/state/ui.svelte.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';

	let { children } = $props();

	// Mounted once for the whole app so "New issue" works from the list, the board and the
	// command menu alike. Temporary home for the "c" shortcut; Phase 7 moves it into
	// a shortcut registry.
	const store = getIssueStore();

	function onKeydown(event: KeyboardEvent) {
		if (event.key.toLowerCase() !== 'c' || event.shiftKey) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.isComposing || event.repeat || event.defaultPrevented) return;
		if (issueUi.createOpen || page.params.id) return;
		const target = event.target;
		// Menus and comboboxes run type-ahead on plain characters, and a dialog's own controls
		// must not summon a second dialog on top.
		if (
			target instanceof Element &&
			target.closest(
				'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="combobox"]'
			)
		) {
			return;
		}
		event.preventDefault();
		issueUi.createOpen = true;
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>SyncTicket</title>
	<meta
		name="description"
		content="A local-first, real-time collaborative issue tracker built with Svelte 5."
	/>
</svelte:head>

<svelte:document onkeydown={onKeydown} />

<ModeWatcher />
<CommandMenu />
<IssueCreateDialog {store} bind:open={issueUi.createOpen} />

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
