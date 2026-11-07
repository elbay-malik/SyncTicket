<script lang="ts">
	import ListTodoIcon from '@lucide/svelte/icons/list-todo';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SquareKanbanIcon from '@lucide/svelte/icons/square-kanban';
	import { tick } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { shortcuts } from '$lib/keyboard/registry.svelte.js';
	import { issueUi } from '$lib/state/ui.svelte.js';
	import { getIssueStore } from '$lib/state/issues.svelte.js';
	import { Kbd } from '$lib/components/ui/kbd/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import BrandMark from './brand-mark.svelte';

	/** For links that keep a new tab in this workspace (`IssueStore.linkQuery`). */
	const store = getIssueStore();

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

	// On a phone the sidebar is a Sheet over the page, and a link inside it navigated underneath
	// while the sheet stayed open — tapping Board appeared to do nothing. Closed on navigation
	// rather than on the links' clicks, so every way of getting somewhere (the palette, `g b`,
	// Back) leaves the page visible, not just the two links in here.
	afterNavigate(() => {
		if (sidebar.isMobile) sidebar.setOpenMobile(false);
	});

	// The same sheet `?` opens, by the same route out of the mobile sidebar as the palette:
	// close the sidebar's own sheet first, so its focus restore does not land inside this one.
	async function openHelp() {
		if (sidebar.isMobile) {
			sidebar.setOpenMobile(false);
			await tick();
		}
		issueUi.helpOpen = true;
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
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- A resolved path, plus `?ws=` when this is not the home workspace (IssueStore.linkQuery). -->
									<a href={resolve('/issues') + store.linkQuery} {...props}>
										<!-- Not circle-dot, which this used to be: that glyph IS a status (In Progress),
										     and DESIGN.md's Circle Belongs to Status Rule keeps rings out of chrome.
										     list-todo won a 16px render beside the mark, the status set and the
										     other chrome glyphs: `ticket`'s side notches echo the mark's split seams,
										     and `layout-list` / `rows-3` merge into `panel-left` and `square-kanban`.
										     Open strokes and a tick, no ring, no closed panel. -->
										<ListTodoIcon />
										<span>Issues</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={page.url.pathname.startsWith('/board')}>
								{#snippet child({ props })}
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- A resolved path, plus `?ws=` when this is not the home workspace (IssueStore.linkQuery). -->
									<a href={resolve('/board') + store.linkQuery} {...props}>
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
		     thing in the app with no visible way to reach it.

		     A button, not a caption. As plain text it was a label pointing at a key: no tab stop,
		     nothing to tap, and on a phone — where Kbd hides its chip — a label pointing at
		     nothing, for a sheet only the `?` key could open. Now it opens the sheet itself, so
		     the label has an action everywhere and the sheet's chips are reachable on touch. -->
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton size="sm" class="text-muted-foreground" onclick={openHelp}>
					<span>Keyboard shortcuts</span>
					{#if helpHint}
						<!-- Out of the accessible name, as on Search: the button is "Keyboard shortcuts". -->
						<Kbd aria-hidden="true" class="ml-auto">{helpHint}</Kbd>
					{/if}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Footer>
</Sidebar.Root>
