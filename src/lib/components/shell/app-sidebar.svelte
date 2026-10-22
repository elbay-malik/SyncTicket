<script lang="ts">
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SquareKanbanIcon from '@lucide/svelte/icons/square-kanban';
	import { tick } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { shortcuts } from '$lib/keyboard/registry.svelte.js';
	import { issueUi } from '$lib/state/ui.svelte.js';
	import { Kbd } from '$lib/components/ui/kbd/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import BrandMark from './brand-mark.svelte';

	const sidebar = Sidebar.useSidebar();

	// Read from the registry rather than written out here, so a hint cannot drift from the
	// chord that actually works — and so it says Ctrl off Apple. Empty until the root
	// layout's onMount has registered, which is also what it renders during SSR.
	const paletteHint = $derived(shortcuts.hint('palette'));
	const helpHint = $derived(shortcuts.hint('help'));

	// Exactly what the ⌘K chord does (see the root layout's registration): one palette, one
	// way in. Search shipped in Phase 8 and lives there; a sidebar entry that only advertised
	// it would be the dead, focusable, unactivatable button this replaces.
	async function openPalette() {
		// On a phone the sidebar *is* a Sheet, and opening the palette from inside it would
		// fire the sheet's focus restore within the palette's focus scope — the same trap the
		// command menu avoids when it opens the create dialog.
		if (sidebar.isMobile) {
			sidebar.setOpenMobile(false);
			await tick();
		}
		issueUi.paletteOpen = true;
	}
</script>

<Sidebar.Root>
	<Sidebar.Header>
		<div class="flex items-center gap-2 px-2 py-1.5">
			<BrandMark class="size-5" />
			<span class="text-sm font-semibold tracking-tight">SyncTicket</span>
		</div>
	</Sidebar.Header>
	<Sidebar.Content>
		<!-- The app's only navigation landmark. Sidebar.Content is a generic scroll container,
		     so the <nav> belongs here, where we know the list is the primary navigation. -->
		<nav aria-label="Workspace">
			<Sidebar.Group>
				<Sidebar.GroupLabel>Workspace</Sidebar.GroupLabel>
				<Sidebar.GroupContent>
					<Sidebar.Menu>
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={page.url.pathname.startsWith('/issues')}>
								{#snippet child({ props })}
									<a href={resolve('/issues')} {...props}>
										<CircleDotIcon />
										<span>Issues</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={page.url.pathname.startsWith('/board')}>
								{#snippet child({ props })}
									<a href={resolve('/board')} {...props}>
										<SquareKanbanIcon />
										<span>Board</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
						<Sidebar.MenuItem>
							<Sidebar.MenuButton onclick={openPalette}>
								<SearchIcon />
								<span>Search</span>
								{#if paletteHint}
									<!-- Hidden from the accessible name, or the button announces as "Search ⌘K". -->
									<Kbd aria-hidden="true" class="ml-auto">{paletteHint}</Kbd>
								{/if}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					</Sidebar.Menu>
				</Sidebar.GroupContent>
			</Sidebar.Group>
		</nav>
	</Sidebar.Content>
	<Sidebar.Footer>
		<!-- The ⌘K hint moved onto the Search item above; the help sheet is otherwise the one
		     thing in the app with no visible way to reach it. -->
		<div class="text-muted-foreground flex items-center justify-between px-2 py-1 text-xs">
			<span>Keyboard shortcuts</span>
			{#if helpHint}
				<Kbd>{helpHint}</Kbd>
			{/if}
		</div>
	</Sidebar.Footer>
</Sidebar.Root>
