<script lang="ts">
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot';
	import ListFilterIcon from '@lucide/svelte/icons/list-filter';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import {
		ISSUE_STATUSES,
		PRIORITY_META,
		STATUS_META,
		type IssueStatus
	} from '$lib/model/issue.js';
	import type { IssueSort } from '$lib/model/query.js';
	import { getIssueStore } from '$lib/state/issues.svelte.js';
	import { IssueQuery } from '$lib/state/queries.svelte.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';

	const store = getIssueStore();
	const query = new IssueQuery(store);

	let draft = $state('');

	const STATUS_DOT: Record<IssueStatus, string> = {
		backlog: 'bg-zinc-400',
		todo: 'bg-blue-500',
		in_progress: 'bg-amber-500',
		done: 'bg-emerald-500',
		canceled: 'bg-red-500'
	};

	const SORT_LABEL: Record<IssueSort, string> = {
		manual: 'Manual order',
		priority: 'Priority',
		recent: 'Recently updated'
	};

	function addIssue(event: SubmitEvent) {
		event.preventDefault();
		const title = draft.trim();
		if (!title) return;
		store.create({ title });
		draft = '';
	}
</script>

<svelte:head>
	<title>Issues · SyncTicket</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-4">
	<div class="flex items-center gap-2">
		<h1 class="text-lg font-semibold tracking-tight">Issues</h1>
		{#if query.total > 0}
			<Badge variant="secondary">{query.total}</Badge>
		{/if}
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
			/>
		</div>
		<Button type="submit" disabled={!draft.trim()}>Add</Button>
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
						<span class="size-2 rounded-full {STATUS_DOT[status]}"></span>
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
			{:else}
				<p class="text-base font-medium">No matching issues</p>
				<p class="text-muted-foreground max-w-sm text-sm">
					No issues match the current filter. Try “All issues”.
				</p>
			{/if}
		</div>
	{:else}
		<ul class="divide-border divide-y rounded-lg border">
			{#each query.results as issue (issue.id)}
				<li class="hover:bg-muted/50 flex items-center gap-3 px-3 py-2.5 transition-colors">
					<span
						class="size-2.5 shrink-0 rounded-full {STATUS_DOT[issue.status]}"
						title={STATUS_META[issue.status].label}
					></span>
					<span class="flex-1 truncate text-sm">{issue.title}</span>
					{#if issue.priority !== 'none'}
						<Badge variant="outline" class="shrink-0 text-xs">
							{PRIORITY_META[issue.priority].label}
						</Badge>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
