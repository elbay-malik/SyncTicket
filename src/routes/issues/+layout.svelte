<script lang="ts">
	// The issue list lives in the layout, not the page, so opening a detail sheet at
	// /issues/[id] keeps the list mounted behind it — filter, sort and quick-add draft all
	// survive the round trip, and the sheet is a real URL that can be shared and reloaded.

	import { onMount, tick } from 'svelte';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import ListFilterIcon from '@lucide/svelte/icons/list-filter';
	import ListTodoIcon from '@lucide/svelte/icons/list-todo';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import XIcon from '@lucide/svelte/icons/x';
	import { afterNavigate, preloadCode } from '$app/navigation';
	import { page } from '$app/state';
	import { connectionCopy } from '$lib/format.js';
	import { ISSUE_STATUSES, STATUS_META } from '$lib/model/issue.js';
	import type { IssueSort } from '$lib/model/query.js';
	import type { PersistenceState } from '$lib/sync/relay-notice.js';
	import { shortcuts } from '$lib/keyboard/registry.svelte.js';
	import { getIssueStore } from '$lib/state/issues.svelte.js';
	import { getPresence } from '$lib/state/presence.svelte.js';
	import { IssueQuery } from '$lib/state/queries.svelte.js';
	import { issueUi } from '$lib/state/ui.svelte.js';
	import { STATUS_UI } from '$lib/components/issues/meta.js';
	import IssueList from '$lib/components/issues/issue-list.svelte';
	import SecondWindowInvite from '$lib/components/shell/second-window-invite.svelte';
	import ViewBoundary from '$lib/components/shell/view-boundary.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Kbd } from '$lib/components/ui/kbd/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';

	let { children } = $props();

	const store = getIssueStore();
	// A browser singleton keyed to the same store the root layout uses, so this is the same
	// Presence instance rather than a second subscription.
	const presence = getPresence(store);
	/**
	 * Whether to invite the second window.
	 *
	 * Only when the relay is genuinely ready and nobody else is here: a visitor who is offline,
	 * still connecting, or has no relay configured cannot be promised that edits merge, and one
	 * who already has a peer has seen the proof and does not need the sentence. The arrival of
	 * that peer is what dismisses it, which is why it needs no dismiss control of its own.
	 */
	const inviteSecondWindow = $derived(
		store.connection === 'connected' && store.relaySynced && presence.peers.length === 0
	);
	const query = new IssueQuery(store);
	/**
	 * Whether the empty state is offering example issues — and so owns this surface's one
	 * primary action. Same condition the empty state renders the button under.
	 *
	 * Seeding is the evaluator's real first step: fourteen issues across every status is what
	 * makes the list, the board and a second window worth looking at. DESIGN.md allows one solid
	 * Ink button per surface, so while it is on offer "New issue" steps down to outline rather
	 * than two black buttons competing for the first click.
	 */
	const offeringExamples = $derived(query.synced && query.total === 0 && store.settled);

	let draft = $state('');
	/** The list's keyboard cursor; the list moves real focus to follow it. */
	let selectedId = $state<string | null>(null);
	let list = $state<ReturnType<typeof IssueList> | null>(null);
	let newIssueButton = $state<HTMLButtonElement | null>(null);

	const SORT_LABEL: Record<IssueSort, string> = {
		// "Board order", not "Manual order": this list cannot reorder anything — dragging exists
		// only on /board, and nothing here writes the `order` key. The old label advertised a
		// capability at the top of the surface that the surface does not have, which is a
		// promise a user discovers is false by looking for a drag handle that was never there.
		// Sectioned by status, it is now literally the board: each section lists in the order
		// its column stacks, so the label names something the visitor can check.
		manual: 'Board order',
		priority: 'Priority',
		recent: 'Recently updated'
	};

	/** How much of an unusable `?ws=` value the notice below quotes back. */
	const INVALID_PARAM_PREVIEW = 32;

	// Whatever was in the link, so it goes out as a text node (never HTML) and is truncated —
	// a long value must not be able to push the rest of the notice off the screen.
	const badWorkspaceParam = $derived.by(() => {
		const raw = store.invalidWorkspaceParam;
		if (raw === null) return null;
		if (raw === '') return 'was empty';
		const shown =
			raw.length > INVALID_PARAM_PREVIEW ? `${raw.slice(0, INVALID_PARAM_PREVIEW)}…` : raw;
		return `was “${shown}”`;
	});

	// The body sentence comes from `connectionCopy`, the same function the status popover
	// renders, so the banner and the popover cannot drift into saying two different things
	// about one fact.
	//
	// `peerCount` is 0 rather than the real count because only `durable` is read here, and
	// that sentence depends on the persistence inputs alone — no reason to subscribe this
	// route to presence just to produce a `shared` sentence nothing renders.
	const persistenceCopy = $derived(
		connectionCopy({
			persisted: store.persisted,
			connection: store.connection,
			relaySynced: store.relaySynced,
			peerCount: 0,
			relayPersistence: store.relayPersistence,
			relayPersistenceReason: store.relayPersistenceReason
		})
	);

	// Exhaustive over the state, including the 'ok' the banner is never rendered in, so that
	// adding a fourth state is a type error here rather than an empty headline in the UI.
	const PERSISTENCE_HEADLINE: Record<PersistenceState, string> = {
		ok: '',
		degraded: 'This workspace has stopped saving on the server',
		stale: "Part of this workspace's history is missing"
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
				run: () => list?.moveCursor(1)
			}),
			shortcuts.register({
				id: 'list-previous',
				chord: 'k',
				label: 'Previous issue',
				group: 'Issues',
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

	// Closing the sheet unmounts it, and bits-ui hands focus back to whatever opened it —
	// except that nothing did. The sheet is a route, so it has no Sheet.Trigger, and a deep
	// link had no row to come from either; focus lands on <body> and the next Tab starts the
	// whole page again. Put it back on the row the sheet belongs to, and fall back to "New
	// issue" only when that row is genuinely gone, which is the delete case.
	afterNavigate(async ({ from }) => {
		// `page.params`, not the callback's `to.params`. On the initial load SvelteKit builds
		// the navigation object from the pre-initialisation `current.params` — an empty object
		// (client.js, the enter-navigation branch) — so every `to.params.id` read is dead on a
		// cold deep link, which is exactly the case this handler exists to serve.
		const arrivedAt = page.params.id;
		// Entering an issue points the list's cursor at it, which is also what keeps that row
		// mounted (virtua renders a window, not the list) so there is something to focus on
		// the way back out — however far down the list it was deep-linked from.
		if (arrivedAt) selectedId = arrivedAt;
		if (!from?.params?.id || arrivedAt) return;
		// Something already owns focus: leave it there rather than yanking it around.
		if (document.activeElement && document.activeElement !== document.body) return;
		const cameFrom = from.params.id;
		await tick();
		const row = document.querySelector<HTMLElement>(`[data-issue-link="${CSS.escape(cameFrom)}"]`);
		// The row's link by attribute, never "whatever the list makes tabbable": which control
		// carries the tab stop is the list's business and it moves.
		(row ?? newIssueButton)?.focus();
	});

	// A `?ws=` that could not be used is taken out of the address bar by the root layout, which
	// puts the real id in its place after every navigation — it is no longer only this route's
	// concern, since every route's address is now the workspace link. The notice above reads
	// the store's record of the bad value, not the URL, so it survives that rewrite and still
	// shows once.

	const activeIssue = $derived(page.params.id ? store.get(page.params.id) : undefined);

	function addIssue(event: SubmitEvent) {
		event.preventDefault();
		const title = draft.trim();
		if (!title) return;
		const id = store.create({ title });
		draft = '';
		// Take the cursor to it and flash it. Without this the field just empties: the new issue
		// is appended after the maximum order key, so under the default sort it lands at the end
		// of its status section — mid-list, and in a virtualized list usually off-screen, with
		// nothing to say it arrived.
		list?.reveal(id);
	}
</script>

<svelte:head>
	<title>{activeIssue ? `${activeIssue.title} · ` : ''}Issues · SyncTicket</title>
</svelte:head>

<div class="mx-auto flex h-full w-full max-w-3xl flex-col gap-4">
	{#if badWorkspaceParam}
		<div
			class="flex items-start gap-3 rounded-lg border border-dashed p-3"
			role="status"
			data-testid="invalid-workspace-link"
		>
			<TriangleAlertIcon class="text-muted-foreground mt-0.5 size-4 shrink-0" />
			<!-- min-w-0 + break-words because the quoted value is whatever was in the link: a
			     flex item will not shrink below its content otherwise, and one long word would
			     push the page sideways on a phone. -->
			<div class="min-w-0 flex-1 space-y-1">
				<p class="text-sm font-medium">That share link wasn't valid</p>
				<p class="text-muted-foreground text-xs break-words">
					The workspace id in it {badWorkspaceParam}, which is not one this app can open — so you're
					in a workspace of your own. Ask whoever sent it for the link again.
				</p>
			</div>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Dismiss this notice"
				onclick={() => store.dismissInvalidWorkspaceParam()}
			>
				<XIcon />
			</Button>
		</div>
	{/if}

	{#if store.relayPersistenceNoticeVisible}
		<!-- `role="status"` makes this an implicit live region, so inserting the banner is
		     itself the announcement; a separate sr-only live region would be redundant. -->
		<div
			class="flex items-start gap-3 rounded-lg border border-dashed p-3"
			role="status"
			data-testid="relay-not-saving"
		>
			<TriangleAlertIcon class="text-muted-foreground mt-0.5 size-4 shrink-0" />
			<div class="min-w-0 flex-1 space-y-1">
				<p class="text-sm font-medium">{PERSISTENCE_HEADLINE[store.relayPersistence]}</p>
				<p class="text-muted-foreground text-xs">{persistenceCopy.durable}</p>
			</div>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Dismiss this notice"
				onclick={() => store.acknowledgeRelayPersistence()}
			>
				<XIcon />
			</Button>
		</div>
	{/if}

	<div class="flex items-center gap-2">
		<h1 class="text-lg font-semibold tracking-tight">Issues</h1>
		{#if query.total > 0}
			<Badge variant="secondary">{query.total}</Badge>
		{/if}
		<Button
			bind:ref={newIssueButton}
			size="sm"
			variant={offeringExamples ? 'outline' : 'default'}
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
				placeholder="Add an issue…"
				aria-label="New issue title"
				class="pl-9"
				onkeydown={(event) => {
					// Single-letter shortcuts are correctly inert while typing, so give the keyboard
					// a way back out of the field without reaching for the mouse.
					if (event.key === 'Escape') event.currentTarget.blur();
				}}
			/>
		</div>
		<!-- `lg` is 36px, matching the field beside it. DESIGN.md documents inputs at 36px and
		     the default button at 32px, so the two are not interchangeable in a row: paired at
		     their defaults the button floats, visibly shorter than the control it submits. -->
		<Button type="submit" size="lg" variant="outline" disabled={!draft.trim()}>Add</Button>
	</form>

	<!-- Required by ADR 0004: the workspace id in the URL is the only thing protecting this
	     workspace, so a visitor has to be told before they type anything real.

	     It used to live in the empty state, which met the letter of that and not its point: a
	     visitor who clicked "Load example issues" or followed a share link into a populated
	     workspace never saw it, and those are the two states where there is something to lose.
	     Here it sits under the field they type into, in every state, which is what the ADR
	     actually asks for. Caption size and muted so it reads as a standing condition rather
	     than an alert that never resolves.

	     "This link" is literal: the root layout keeps the workspace's `?ws=` in the address bar
	     on every route, so the link in front of the visitor is the one this sentence means.
	     Before that it pointed at a bare `/issues` that opened anyone else a new workspace. -->
	<p class="text-muted-foreground -mt-1 text-xs">
		Anyone with this link can read and edit this workspace — please don't put anything real or
		sensitive in it.
	</p>

	<!-- Shown only while the relay is ready and nobody else is here; a second peer arriving is
	     what removes it, which is the proof arriving. -->
	{#if inviteSecondWindow}
		<SecondWindowInvite workspaceId={store.workspaceId} />
	{/if}

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
			<!-- The Issues nav's own glyph, so the empty state names the place it is the empty state
			     of. It was circle-dot, which is a status (In Progress) and so breaks DESIGN.md's
			     Circle Belongs to Status Rule; see app-sidebar.svelte for why list-todo won. -->
			<ListTodoIcon class="text-muted-foreground size-8" />
			{#if query.total === 0}
				<p class="text-base font-medium">No issues yet</p>
				<p class="text-muted-foreground max-w-sm text-sm">
					Add one above — it's stored entirely in your browser (local-first, offline-ready) and
					reappears after a reload.
				</p>
				<!-- Seeding is offered only once the workspace has actually finished arriving. An
				     empty IndexedDB syncs in milliseconds, so someone following a share link looks
				     empty long before the relay has said a word — and fourteen example issues
				     appended into somebody else's backlog is not something a CRDT can take back. -->
				{#if store.settled}
					<Button size="sm" onclick={() => store.seedDemo()}>
						<SparklesIcon />
						Load example issues
					</Button>
				{:else}
					<p class="text-muted-foreground max-w-sm text-xs" data-testid="issues-awaiting-relay">
						Still checking for issues shared with this link…
					</p>
				{/if}
			{:else}
				<p class="text-base font-medium">No matching issues</p>
				<p class="text-muted-foreground max-w-sm text-sm">
					No issues match the current filter. Try “All issues”.
				</p>
			{/if}
		</div>
	{:else}
		<!-- Takes what the controls above leave, but never less than a usable list. On a screen too
		     short for both, `<main>` scrolls them past each other. -->
		<div class="min-h-64 flex-1">
			<!-- Sectioned only across every status: filtered to one, the filter button above already
			     names the only section there would be. -->
			<ViewBoundary
				title="The list couldn’t be shown"
				class="min-h-[40vh] rounded-lg border border-dashed p-12"
			>
				<IssueList
					bind:this={list}
					issues={query.results}
					{store}
					sectioned={query.status === 'all'}
					bind:selectedId
				/>
			</ViewBoundary>
		</div>
	{/if}
</div>

{@render children()}
