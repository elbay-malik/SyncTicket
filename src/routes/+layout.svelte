<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { ModeWatcher } from 'mode-watcher';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import AppSidebar from '$lib/components/shell/app-sidebar.svelte';
	import BrandMark from '$lib/components/shell/brand-mark.svelte';
	import CommandMenu from '$lib/components/shell/command-menu.svelte';
	import RelayStatus from '$lib/components/shell/relay-status.svelte';
	import ShareWorkspace from '$lib/components/shell/share-workspace.svelte';
	import PresenceBar from '$lib/components/presence/presence-bar.svelte';
	import ThemeToggle from '$lib/components/shell/theme-toggle.svelte';
	import IssueCreateDialog from '$lib/components/issues/issue-create-dialog.svelte';
	import ShortcutsHelp from '$lib/components/shell/shortcuts-help.svelte';
	import { isApple } from '$lib/keyboard/keys.js';
	import { shortcuts } from '$lib/keyboard/registry.svelte.js';
	import { getSearchClient } from '$lib/search/client.svelte.js';
	import { getIssueStore } from '$lib/state/issues.svelte.js';
	import { getPresence } from '$lib/state/presence.svelte.js';
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
	// Bound to the store's awareness channel, which exists whether or not a relay is
	// configured — so with no relay this simply shows one person: you.
	const presence = getPresence(store);

	let helpOpen = $state(false);

	onMount(() => {
		// Started here rather than on first search: the worker and its index chunk are fetched
		// when it is constructed, and a user who has already gone offline could never fetch
		// them. Same reasoning as the issues layout preloading the detail route.
		getSearchClient().start(store);
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
			// Undo and redo are registered here rather than on the issues route because they are
			// not a list feature: a status changed from the board, or from the detail sheet, is
			// the same edit and the same stack.
			//
			// Deliberately NOT `hidden: true`. Every other real feature this app hid from the
			// shortcuts sheet (j/k) turned out to be undiscoverable in practice, and an undo
			// nobody knows about does not do the one job it exists for in a shared workspace
			// with no accounts: making a mis-click recoverable.
			//
			// NOT `allowInInput`, which was the first version and was wrong. The registry calls
			// `preventDefault()` before `run()` and cannot take it back, so a document-level ⌘Z
			// inside a text field would swallow the browser's own undo — which is character-level
			// and strictly better for the field you are actually typing in — and replace it with
			// a CRDT undo of the last *committed* change. Leaving inputs alone gives each undo
			// the scope it is good at: the browser's inside a field, this one everywhere else.
			shortcuts.register({
				id: 'undo',
				chord: 'mod+z',
				label: 'Undo my last change',
				group: 'Issues',
				run: () => store.undo()
			}),
			shortcuts.register({
				id: 'redo',
				chord: 'mod+shift+z',
				label: 'Redo',
				group: 'Issues',
				run: () => store.redo()
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
	<!--
		First in the DOM, and so the first tab stop: the sidebar's navigation and the whole
		header sit ahead of the page on every route. Inside Sidebar.Inset it would render
		*after* the sidebar and skip nothing. `sr-only` is already position:absolute, so it
		never takes part in the wrapper's flex layout; `fixed` on focus keeps it in the
		corner rather than wherever the nearest positioned ancestor happens to be. The
		target's tabindex="-1" is what makes focus land there instead of only the scroll.
	-->
	<a
		href="#main-content"
		class="sr-only focus:not-sr-only focus:bg-background focus:ring-ring focus:fixed focus:start-4 focus:top-3 focus:z-50 focus:rounded-md focus:px-3 focus:py-1.5 focus:text-sm focus:font-medium focus:shadow-sm focus:ring-2"
	>
		Skip to content
	</a>
	<AppSidebar />
	<Sidebar.Inset>
		<!-- Wraps rather than overflows: at 320px (1280px at 400% zoom, WCAG 1.4.10) the
		     trailing group is ~10px too wide for one line. `min-h-12` keeps the usual height
		     everywhere it does fit, which is what the flex column below it relies on. -->
		<header class="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-1">
			<Sidebar.Trigger />
			<Separator orientation="vertical" class="data-[orientation=vertical]:h-4" />
			<BrandMark class="size-4 shrink-0" />
			<span class="text-sm font-medium">SyncTicket</span>
			<div class="ml-auto flex flex-wrap items-center justify-end gap-2">
				<PresenceBar {presence} />
				<Separator orientation="vertical" class="data-[orientation=vertical]:h-4" />
				<RelayStatus {store} {presence} />
				<ShareWorkspace {store} />
				<ThemeToggle />
			</div>
		</header>
		<main id="main-content" tabindex="-1" class="min-h-0 flex-1 overflow-auto p-6">
			{@render children()}
		</main>
	</Sidebar.Inset>
</Sidebar.Provider>
