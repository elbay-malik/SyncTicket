<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { ModeWatcher } from 'mode-watcher';
	import { onMount } from 'svelte';
	import type { Snapshot } from '@sveltejs/kit';
	import { afterNavigate, goto, preloadCode } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import AppSidebar from '$lib/components/shell/app-sidebar.svelte';
	import Undo2Icon from '@lucide/svelte/icons/undo-2';
	import { Button } from '$lib/components/ui/button/index.js';
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
	import { workspaceAddress } from '$lib/model/workspace.js';
	import { getIssueStore } from '$lib/state/issues.svelte.js';
	import { getPresence } from '$lib/state/presence.svelte.js';
	import { issueUi } from '$lib/state/ui.svelte.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';

	let { children } = $props();

	let main = $state<HTMLElement | null>(null);

	// `<main>` scrolls where the window used to, on a screen too short for what a route shows, and
	// the window's position is the only one SvelteKit keeps. The list keeps its own, in its route.
	export const snapshot: Snapshot<number> = {
		capture: () => main?.scrollTop ?? 0,
		restore: (top) => {
			if (main) main.scrollTop = top;
		}
	};

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

	// The address bar is the workspace link. Internal links carry no `?ws=` (threading it through
	// every `resolve()` is what the remembered id saves), so without this the bar showed a bare
	// `/issues` — and an evaluator who copied it to a phone opened a fresh, empty workspace and
	// concluded that sync was broken. After every navigation, including the first, the current
	// address is put back in step with the workspace this session is actually in. That also
	// covers a visitor who arrived with no parameter and was minted one, and one whose `?ws=`
	// was unusable: the bad value is replaced by the real id rather than left to be reloaded or
	// copied on (the notice saying so is the issues route's, and reads the store, not the URL).
	//
	// `replaceState` rewrites the entry rather than adding one, so Back never walks through a
	// bare twin of every page; `keepFocus` and `noScroll` because nothing the visitor can see
	// has changed, and the list's own afterNavigate decides where focus goes.
	//
	// Deferred by a microtask because SvelteKit marks the router started *after* running these
	// callbacks for the initial load, so navigating from inside this call races hydration. Read
	// from `page.url` inside the microtask rather than the callback's `to`: by then it is the
	// router's settled answer for this page, path and all, which is what keeps a deep-linked
	// sheet open — `to.params` is the empty pre-initialisation object on a cold load.
	afterNavigate(() => {
		void Promise.resolve().then(() => {
			const address = workspaceAddress(page.url, store.workspaceId);
			if (address.kind === 'replace') {
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- The router's own current URL with one query parameter changed: the path is the one SvelteKit just resolved, and `resolve()` takes a route id, not a URL.
				void goto(address.url, { replaceState: true, keepFocus: true, noScroll: true });
			} else if (address.kind === 'reload') {
				location.reload();
			}
		});
	});

	onMount(() => {
		// Started here rather than on first search: the worker and its index chunk are fetched
		// when it is constructed, and a user who has already gone offline could never fetch
		// them. Same reasoning as preloading every route below.
		getSearchClient().start(store);
		// Each route is a lazily imported chunk. Fetching them all now, wherever the visit
		// started, is what lets every page open offline: a chunk first requested offline fails,
		// and Chromium remembers the failed import for the life of the page, so even once the
		// network is back that route kept showing an error until a reload.
		for (const path of ['/issues', '/issues/*', '/board']) void preloadCode(path);
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
				run: () => (issueUi.helpOpen = true)
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
<ShortcutsHelp bind:open={issueUi.helpOpen} />

<!-- `h-svh`, because the provider's own `min-h-svh` is only a floor. With nothing above it
     holding a height, the shell grew to fit the page and `<main>` never scrolled, and neither
     did the list inside it, so virtua saw room for every row and mounted them all. -->
<Sidebar.Provider class="h-svh">
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
				<!-- Undo needs a pixel. ⌘Z is registered and listed in the shortcuts sheet, but in a
				     workspace with no accounts, where anyone holding the link can change anything,
				     a mouse-only visitor who mis-sets a status had no way back at all. Disabled
				     rather than hidden when the stack is empty, so the affordance is discoverable
				     before it is needed rather than appearing only once something has gone wrong. -->
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Undo my last change"
					title="Undo my last change"
					disabled={!store.canUndo}
					onclick={() => store.undo()}
				>
					<Undo2Icon />
				</Button>
				<ShareWorkspace {store} />
				<!-- Steps aside below `sm`, where the trailing group would otherwise wrap to a third
				     line carrying this control alone — 36px of a 320px-wide screen for one icon.
				     The capability is not lost: the command palette offers Light, Dark and System,
				     and the palette is reachable on a phone through the sidebar's Search item
				     (`a11y-shell.e2e.ts` covers that path). Durability state and undo keep their
				     place here instead, which is the right way round: one is this product's
				     highest-stakes fact and the other is the only way back from a mis-click. -->
				<span class="hidden sm:inline-flex">
					<ThemeToggle />
				</span>
			</div>
		</header>
		<main bind:this={main} id="main-content" tabindex="-1" class="min-h-0 flex-1 overflow-auto p-6">
			{@render children()}
		</main>
	</Sidebar.Inset>
</Sidebar.Provider>
