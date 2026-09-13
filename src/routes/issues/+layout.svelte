<script lang="ts">
	// The issue list lives in the layout, not the page, so opening a detail sheet at
	// /issues/[id] keeps the list mounted behind it — filter, sort and quick-add draft all
	// survive the round trip, and the sheet is a real URL that can be shared and reloaded.

	import { onMount } from 'svelte';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot';
	import ListFilterIcon from '@lucide/svelte/icons/list-filter';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import { afterNavigate, preloadCode } from '$app/navigation';
	import { page } from '$app/state';
	import { ISSUE_STATUSES, STATUS_META } from '$lib/model/issue.js';
	import type { IssueSort } from '$lib/model/query.js';
	import { shortcuts } from '$lib/keyboard/registry.svelte.js';
	import { getIssueStore } from '$lib/state/issues.svelte.js';
	import { IssueQuery } from '$lib/state/queries.svelte.js';
	import { issueUi } from '$lib/state/ui.svelte.js';
	import { STATUS_UI } from '$lib/components/issues/meta.js';
	import IssueList from '$lib/components/issues/issue-list.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Kbd } from '$lib/components/ui/kbd/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';

	let { children } = $props();

	const store = getIssueStore();
	const query = new IssueQuery(store);

	let draft = $state('');
	/** The list's keyboard cursor; the list moves real focus to follow it. */
	let selectedId = $state<string | null>(null);
	let list = $state<ReturnType<typeof IssueList> | null>(null);
	let newIssueButton = $state<HTMLButtonElement | null>(null);

	const SORT_LABEL: Record<IssueSort, string> = {
		manual: 'Manual order',
		priority: 'Priority',
		recent: 'Recently updated'
	};

	// j/k work from anywhere on this route; the arrow keys are handled by the list itself,
	// where they cannot suppress page scrolling or fight another widget for the same key.
	onMount(() => {
		const off = [
			shortcuts.register({
				id: 'list-next',
				chord: 'j',
				label: 'Next issue',
				group: 'Issues',
				hidden: true,
				run: () => list?.moveCursor(1)
			}),
			shortcuts.register({
				id: 'list-previous',
				chord: 'k',
				label: 'Previous issue',
				group: 'Issues',
				hidden: true,
				run: () => list?.moveCursor(-1)
			})
		];
		return () => off.forEach((unregister) => unregister());
	});

	// The detail route is a separate lazily-imported chunk. Fetching it as soon as the list
	// mounts is what makes opening an issue work offline — otherwise the first navigation
	// after losing connectivity has no code to load and lands on an error page.
	onMount(() => {
		void preloadCode('/issues/*');
	});

	// Closing the sheet unmounts it, and bits-ui restores focus to whatever opened it. That
	// element is gone after a delete, and never existed on a deep link, so put focus
	// somewhere sensible instead of letting it fall to <body>.
	afterNavigate(({ from, to }) => {
		if (!from?.params?.id || to?.params?.id) return;
		if (document.activeElement && document.activeElement !== document.body) return;
		newIssueButton?.focus();
	});

	const activeIssue = $derived(page.params.id ? store.get(page.params.id) : undefined);

	function addIssue(event: SubmitEvent) {
		event.preventDefault();
		const title = draft.trim();
		if (!title) return;
		store.create({ title });
		draft = '';
	}
</script>

<svelte:head>
	<title>{activeIssue ? `${activeIssue.title} · ` : ''}Issues · SyncTicket</title>
</svelte:head>

<div class="mx-auto flex h-full w-full max-w-3xl flex-col gap-4">
	<div class="flex items-center gap-2">
		<h1 class="text-lg font-semibold tracking-tight">Issues</h1>
		{#if query.total > 0}
			<Badge variant="secondary">{query.total}</Badge>
		{/if}
		<Button
			bind:ref={newIssueButton}
			size="sm"
			class="ml-auto"
			onclick={() => (issueUi.createOpen = true)}
		>
			<PlusIcon />
			New issue
			<Kbd aria-hidden="true">C</Kbd>
		</Button>
	</div>

	<form onsubmit={addIssue} class="flex items-center gap-2">
		<div class="relative flex-1">
			<PlusIcon
				class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
			/>
			<Input
				bind:value={draft}
				placeholder="Add an issue and press Enter…"
				aria-label="New issue title"
				class="pl-9"
				onkeydown={(event) => {
					// Single-letter shortcuts are correctly inert while typing, so give the keyboard
					// a way back out of the field without reaching for the mouse.
					if (event.key === 'Escape') event.currentTarget.blur();
				}}
			/>
		</div>
		<Button type="submit" variant="outline" disabled={!draft.trim()}>Add</Button>
	</form>

	<div class="flex items-center justify-between">
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm">
						<ListFilterIcon class="size-4" />
						{query.status === 'all' ? 'All issues' : STATUS_META[query.status].label}
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="start">
				<DropdownMenu.Item onclick={() => (query.status = 'all')}>
					All issues
					<span class="text-muted-foreground ml-auto">{query.total}</span>
				</DropdownMenu.Item>
				<DropdownMenu.Separator />
				{#each ISSUE_STATUSES as status (status)}
					<DropdownMenu.Item onclick={() => (query.status = status)}>
						<span class="size-2 rounded-full {STATUS_UI[status].dot}"></span>
						{STATUS_META[status].label}
						<span class="text-muted-foreground ml-auto">{query.counts[status]}</span>
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>

		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="ghost" size="sm">
						<ArrowUpDownIcon class="size-4" />
						{SORT_LABEL[query.sort]}
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end">
				{#each Object.entries(SORT_LABEL) as [value, label] (value)}
					<DropdownMenu.Item onclick={() => (query.sort = value as IssueSort)}>
						{label}
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</div>

	<Separator />

	{#if !query.synced}
		<div class="flex flex-col gap-2" data-testid="issues-loading">
			{#each [0, 1, 2] as row (row)}
				<Skeleton class="h-11 w-full" />
			{/each}
		</div>
	{:else if query.results.length === 0}
		<div
			class="flex min-h-[40vh] flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-12 text-center"
		>
			<CircleDotIcon class="text-muted-foreground size-8" />
			{#if query.total === 0}
				<p class="text-base font-medium">No issues yet</p>
				<p class="text-muted-foreground max-w-sm text-sm">
					Add one above — it's stored entirely in your browser (local-first, offline-ready) and
					reappears after a reload.
				</p>
				<Button variant="outline" size="sm" onclick={() => store.seedDemo()}>
					<SparklesIcon />
					Load example issues
				</Button>
			{:else}
				<p class="text-base font-medium">No matching issues</p>
				<p class="text-muted-foreground max-w-sm text-sm">
					No issues match the current filter. Try “All issues”.
				</p>
			{/if}
		</div>
	{:else}
		<div class="min-h-0 flex-1">
			<IssueList bind:this={list} issues={query.results} {store} bind:selectedId />
		</div>
	{/if}
</div>

{@render children()}
