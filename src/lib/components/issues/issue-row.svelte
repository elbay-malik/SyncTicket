<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		issueIdParam,
		type Issue,
		type IssuePriority,
		type IssueStatus
	} from '$lib/model/issue.js';
	import type { IssueStore } from '$lib/state/issues.svelte.js';
	import type { Peer } from '$lib/state/presence.svelte.js';
	import { listNames } from '$lib/format.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import PeerAvatars from '$lib/components/presence/peer-avatars.svelte';
	import RemoteTrace from '$lib/components/presence/remote-trace.svelte';
	import RemoteTraceAuthor from '$lib/components/presence/remote-trace-author.svelte';
	import PriorityPicker from './priority-picker.svelte';
	import StatusPicker from './status-picker.svelte';

	let {
		issue,
		store,
		selected = false,
		flash = false,
		tabbable = false,
		viewers = []
	}: {
		issue: Issue;
		store: IssueStore;
		selected?: boolean;
		/** Briefly marks a row the visitor just created, so the scroll lands on something. */
		flash?: boolean;
		/** Whether this is the cursor row, and so carries the list's single tab stop. */
		tabbable?: boolean;
		/** Other people with this issue open right now. */
		viewers?: readonly Peer[];
	} = $props();

	// Folded into the link's own text rather than announced separately: the link is what a
	// screen reader lands on, and a row that reads "Fix login redirect, Ada Lovelace is
	// viewing" is one coherent announcement instead of two competing ones.
	const viewerSentence = $derived(
		viewers.length === 0
			? ''
			: `${listNames(viewers.map((peer) => peer.name))} ${viewers.length === 1 ? 'is' : 'are'} viewing`
	);

	// Read here rather than passed down: it is a map lookup on the store the row already has,
	// and every row reading its own entry keeps the list from re-rendering all of them when
	// one changes.
	const remote = $derived(store.remote.get(issue.id));
	// The author's disc, unless they are already in the viewer stack beside it — someone typing
	// into this issue's sheet is shown there, and two of the same face in one row is noise.
	const traceAuthor = $derived(
		remote?.author && !viewers.some((peer) => peer.userId === remote.author?.userId)
			? remote
			: undefined
	);
</script>

<!--
	The row is the *contents* of a list item, not the <li> itself: the virtualizer owns the
	item element so it can position and measure it (see issue-list.svelte).

	`data-issue-row` is how the list works out which row focus is in, for a cursor move that
	starts from a row reached with the mouse and for the Left/Right walk across the row's
	controls.
-->
<div
	data-issue-row={issue.id}
	class="group hover:bg-muted/50 relative isolate flex items-center gap-2 px-2 py-1.5 transition-colors"
	class:bg-muted={selected}
	class:row-flash={flash}
>
	<!-- `relative isolate` on the row is what puts this under the row's controls and over its
	     own fill — a trace that tinted the focus ring would weaken the one indicator whose
	     contrast was measured. -->
	<RemoteTrace change={remote} />

	<!-- The pickers are siblings of the link, not descendants, so their clicks never reach
	     it — no propagation guard is needed (and adding onclick after the trigger's spread
	     props would clobber bits-ui's own handler).

	     tabindex -1 in every row, cursor row included: the list's one tab stop is the cursor
	     row's link, and these are reached with Left/Right once focus is in the row. Left as
	     ordinary buttons they were each a tab stop of their own, which is what made Tab walk
	     every rendered row three times over. -->
	<StatusPicker
		value={issue.status}
		tabindex={-1}
		onchange={(status: IssueStatus) => store.update(issue.id, { status })}
	/>

	<!--
		Roving tabindex: only the cursor row is tabbable, so Tab enters the list once and lands
		where the cursor is rather than walking every row. The anchor is also what the list
		focuses when the cursor moves, which is what makes a screen reader announce the row —
		and it keeps Enter as ordinary link activation instead of a global shortcut.
	-->
	<!-- eslint-disable svelte/no-navigation-without-resolve -- A resolved path, plus `?ws=` when this is not the home workspace (IssueStore.linkQuery). -->
	<a
		href={resolve('/issues/[id]', { id: issueIdParam(issue.id) }) + store.linkQuery}
		data-issue-link={issue.id}
		tabindex={tabbable ? 0 : -1}
		aria-current={selected ? 'true' : undefined}
		class="focus-visible:ring-ring flex-1 truncate rounded-sm px-1 py-1 text-sm underline-offset-4 outline-none group-hover:underline focus-visible:ring-2"
	>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{issue.title}
		{#if viewerSentence}<span class="sr-only">, {viewerSentence}</span>{/if}
	</a>

	<RemoteTraceAuthor change={traceAuthor} />

	<!-- Decoration only; the sentence above is what carries this to a screen reader. -->
	<PeerAvatars peers={viewers} max={2} size="sm" summary="" testId="row-viewers" />

	{#if issue.labels.length > 0}
		<div class="hidden shrink-0 gap-1 sm:flex">
			{#each issue.labels.slice(0, 2) as label (label)}
				<Badge variant="secondary" class="text-xs">{label}</Badge>
			{/each}
		</div>
	{/if}

	<PriorityPicker
		value={issue.priority}
		tabindex={-1}
		onchange={(priority: IssuePriority) => store.update(issue.id, { priority })}
	/>
</div>
