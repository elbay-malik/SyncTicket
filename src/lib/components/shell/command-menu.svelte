<script lang="ts">
	// The palette is both the command list and the issue search box.
	//
	// bits-ui filters its own items by scoring the item's `value` against what was typed, and
	// that has to be switched off here: an issue matched on its description — or, once the
	// model is warm, on meaning rather than words — scores zero against its title and would
	// be silently dropped. With `shouldFilter={false}` the commands need filtering of their
	// own, so they are scored with bits-ui's own function and the behaviour is unchanged.

	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import SunIcon from '@lucide/svelte/icons/sun';
	import { tick } from 'svelte';
	import { computeCommandScore } from 'bits-ui';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { resetMode, setMode } from 'mode-watcher';
	import { shortcuts } from '$lib/keyboard/registry.svelte.js';
	import { getSearchClient } from '$lib/search/client.svelte.js';
	import { getIssueStore } from '$lib/state/issues.svelte.js';
	import { issueUi } from '$lib/state/ui.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Command from '$lib/components/ui/command/index.js';
	import StatusBadge from '$lib/components/issues/status-badge.svelte';

	const store = getIssueStore();
	const search = getSearchClient();

	let query = $state('');
	/** Which item bits-ui considers current; set explicitly when results arrive. */
	let selected = $state('');

	const GROUPS = ['Issues', 'Navigation'] as const;

	interface Command {
		id: string;
		label: string;
		hint: string;
		group: string;
		run: () => void;
	}

	const commands = $derived<Command[]>([
		...GROUPS.flatMap((group) =>
			shortcuts.listed
				// Offering "open the command palette" inside the open palette is silly.
				.filter((shortcut) => shortcut.group === group && shortcut.id !== 'palette')
				.map((shortcut) => ({
					id: shortcut.id,
					label: shortcut.label,
					hint: shortcut.hint,
					group,
					run: shortcut.run
				}))
		),
		{
			id: 'theme-light',
			label: 'Light theme',
			hint: '',
			group: 'Theme',
			run: () => setMode('light')
		},
		{ id: 'theme-dark', label: 'Dark theme', hint: '', group: 'Theme', run: () => setMode('dark') },
		{ id: 'theme-system', label: 'System theme', hint: '', group: 'Theme', run: () => resetMode() }
	]);

	// The filtering bits-ui would have done, done here so results can bypass it.
	const matchingCommands = $derived(
		query.trim()
			? commands
					.map((command) => ({ command, score: computeCommandScore(command.label, query) }))
					.filter((scored) => scored.score > 0)
					.sort((a, b) => b.score - a.score)
					.map((scored) => scored.command)
			: commands
	);

	const groupedCommands = $derived(
		['Issues', 'Navigation', 'Theme']
			.map((group) => ({ group, items: matchingCommands.filter((c) => c.group === group) }))
			.filter((section) => section.items.length > 0)
	);

	// Results are ids; the issue is read from the store so a title edited since the reply, or
	// an issue deleted since, is never rendered from a stale snapshot.
	const results = $derived(
		search.ids.map((id) => store.get(id)).filter((issue) => issue !== undefined)
	);

	$effect(() => {
		search.search(query);
	});

	// bits-ui picks the first item the moment the query changes, which is before any result
	// has arrived, so Enter would run a command while the user is looking at an issue.
	$effect(() => {
		const first = results[0];
		selected = first ? `issue:${first.id}` : (matchingCommands[0]?.label ?? '');
	});

	async function run(action: () => void) {
		issueUi.paletteOpen = false;
		// Let this dialog finish closing first: opening another in the same tick lets the
		// palette's focus restore fire inside the new dialog's focus scope.
		await tick();
		action();
	}
</script>

<!--
	vimBindings must be off: bits-ui's Command treats Ctrl+K as "previous item" and calls
	preventDefault, which would swallow the palette's own toggle on Linux and Windows — and
	so on CI, where the e2e runs.
-->
<Command.Dialog
	bind:open={issueUi.paletteOpen}
	bind:value={selected}
	vimBindings={false}
	shouldFilter={false}
>
	<Command.Input placeholder="Search issues or run a command…" bind:value={query} />
	<Command.List>
		<!-- The viewport is what gives Command.Input its aria-controls and
		     aria-activedescendant; without it the highlighted item is never announced. -->
		<Command.Viewport>
			<Command.Empty>No results found.</Command.Empty>

			{#if results.length > 0}
				<!-- A distinct value: bits-ui keys groups in one map, and an "Issues" heading
				     already exists for the shortcut group. -->
				<Command.Group heading="Issues" value="issue-results">
					{#each results as issue (issue.id)}
						<!-- Keyed by id, not title: two issues can share a title, and a title can
						     equal a command's label. -->
						<Command.Item
							value={`issue:${issue.id}`}
							onSelect={() => run(() => goto(resolve('/issues/[id]', { id: issue.id })))}
						>
							<StatusBadge value={issue.status} showLabel={false} />
							<span class="truncate">{issue.title}</span>
						</Command.Item>
					{/each}
				</Command.Group>
			{/if}

			{#each groupedCommands as section (section.group)}
				<Command.Group heading={section.group} value={`commands-${section.group}`}>
					{#each section.items as command (command.id)}
						<Command.Item value={command.label} onSelect={() => run(command.run)}>
							{#if command.id === 'theme-light'}<SunIcon />{/if}
							{#if command.id === 'theme-dark'}<MoonIcon />{/if}
							{#if command.id === 'theme-system'}<MonitorIcon />{/if}
							{command.label}
							{#if command.hint}
								<Command.Shortcut aria-hidden="true">{command.hint}</Command.Shortcut>
							{/if}
						</Command.Item>
					{/each}
				</Command.Group>
			{/each}
		</Command.Viewport>
	</Command.List>

	<div
		class="text-muted-foreground flex items-center gap-2 border-t px-3 py-2 text-xs"
		data-testid="search-mode"
	>
		<SearchIcon class="size-3.5" />
		{#if search.semantic === 'ready'}
			<span>Searching words and meaning</span>
		{:else if search.semantic === 'loading'}
			<span>Loading the language model… {Math.round(search.progress * 100)}%</span>
		{:else if search.semantic === 'failed'}
			<span>Meaning search unavailable; searching words</span>
			<Button variant="ghost" size="xs" class="ml-auto" onclick={() => search.warm()}>
				<SparklesIcon />
				Try again
			</Button>
		{:else}
			<span>Searching words</span>
			<Button variant="ghost" size="xs" class="ml-auto" onclick={() => search.warm()}>
				<SparklesIcon />
				Add meaning search
			</Button>
		{/if}
	</div>
</Command.Dialog>
