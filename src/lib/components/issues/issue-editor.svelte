<script lang="ts">
	// The editable body of the detail sheet. It is a separate component from the sheet on
	// purpose: the sheet renders it inside {#key issue.id}, and only a component boundary
	// resets `$state` — a {#key} block re-creates DOM but leaves the enclosing component's
	// script state (and any pending timer) untouched, which would leak one issue's draft
	// into the next. Taking a non-nullable `issue` also keeps every handler free of null
	// guards.
	//
	// Editing model: each field holds a *nullable draft*. Null means "not editing" and the
	// input shows the live CRDT value, so remote changes (Phase 9) flow straight through.
	// The first keystroke makes the draft non-null; commit writes it back and returns to
	// null. Deliberately no `$effect` — drafts are set from DOM events only, so there is no
	// state-syncing loop to get wrong.

	import { onDestroy } from 'svelte';
	import type { Issue, IssuePriority, IssueStatus } from '$lib/model/issue.js';
	import { formatLabels, parseLabels } from '$lib/model/labels.js';
	import { isoTime, relativeTime } from '$lib/format.js';
	import type { IssueStore } from '$lib/state/issues.svelte.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import PriorityPicker from './priority-picker.svelte';
	import StatusPicker from './status-picker.svelte';

	let { issue, store }: { issue: Issue; store: IssueStore } = $props();

	let titleDraft = $state<string | null>(null);
	let descriptionDraft = $state<string | null>(null);
	let assigneeDraft = $state<string | null>(null);
	let labelsDraft = $state<string | null>(null);

	function commitTitle() {
		const next = titleDraft;
		titleDraft = null;
		// A blank title is dropped by patchIssue (a stored '' would render forever), so
		// reverting here just makes the input snap back to the live value.
		if (next !== null) store.update(issue.id, { title: next });
	}

	function commitDescription() {
		const next = descriptionDraft;
		descriptionDraft = null;
		if (next !== null) store.update(issue.id, { description: next });
	}

	function commitAssignee() {
		const next = assigneeDraft;
		assigneeDraft = null;
		if (next !== null) store.update(issue.id, { assignee: next.trim() || null });
	}

	function commitLabels() {
		const next = labelsDraft;
		labelsDraft = null;
		if (next !== null) store.update(issue.id, { labels: parseLabels(next) });
	}

	/**
	 * Escape reverts the field being edited and keeps focus, then stops propagating so the
	 * sheet stays open. bits-ui listens for Escape on the document in the bubble phase, so
	 * a second Escape — with the draft now null — reaches it and closes the sheet.
	 */
	function cancelOnEscape(event: KeyboardEvent, isEditing: boolean, revert: () => void) {
		if (event.key !== 'Escape' || !isEditing) return;
		revert();
		event.stopPropagation();
	}

	// Closing the sheet by clicking the overlay, pressing Back, or navigating away unmounts
	// this component without ever firing `blur`, so an uncommitted draft would be lost.
	// Flushing on destroy makes "it saved what I typed" true on every close path.
	onDestroy(() => {
		if (titleDraft !== null) store.update(issue.id, { title: titleDraft });
		if (descriptionDraft !== null) store.update(issue.id, { description: descriptionDraft });
		if (assigneeDraft !== null) store.update(issue.id, { assignee: assigneeDraft.trim() || null });
		if (labelsDraft !== null) store.update(issue.id, { labels: parseLabels(labelsDraft) });
	});
</script>

<div class="flex min-w-0 flex-col gap-5 px-4 pb-4">
	<div class="flex flex-col gap-1.5">
		<!-- The title's `pr-9` clears the sheet's close button, which is absolutely positioned
		     in the sheet's top-right corner and otherwise sits on top of the end of the title
		     at every width — the title is the first thing in the editor, so they collide. -->
		<Label for="issue-title" class="sr-only">Title</Label>
		<Input
			id="issue-title"
			aria-label="Title"
			value={titleDraft ?? issue.title}
			oninput={(event) => (titleDraft = event.currentTarget.value)}
			onblur={commitTitle}
			onkeydown={(event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					commitTitle();
				}
				cancelOnEscape(event, titleDraft !== null, () => (titleDraft = null));
			}}
			class="h-auto border-transparent bg-transparent px-2 py-1 pr-9 text-base font-medium shadow-none dark:bg-transparent"
		/>
	</div>

	<div class="flex flex-col gap-1.5">
		<Label for="issue-description">Description</Label>
		<Textarea
			id="issue-description"
			aria-label="Description"
			rows={6}
			placeholder="Add a description…"
			value={descriptionDraft ?? issue.description}
			oninput={(event) => (descriptionDraft = event.currentTarget.value)}
			onblur={commitDescription}
			onkeydown={(event) => {
				// Enter inserts a newline here; ⌘/Ctrl+Enter is the explicit "save" gesture.
				if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
					event.preventDefault();
					commitDescription();
				}
				cancelOnEscape(event, descriptionDraft !== null, () => (descriptionDraft = null));
			}}
		/>
	</div>

	<!-- `minmax(0,1fr)` rather than `1fr`: a 1fr track takes `min-width: auto`, so the inputs'
	     intrinsic minimum widened this grid past the sheet that contains it. In a 320px viewport
	     the sheet is 240px and the fields ran off its right edge — title included, because the
	     column above stretches to whatever this grid forced the editor to become. The track has
	     to be allowed to shrink. -->
	<div class="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
		<span class="text-muted-foreground text-sm">Status</span>
		<div>
			<StatusPicker
				value={issue.status}
				showLabel
				onchange={(status: IssueStatus) => store.update(issue.id, { status })}
			/>
		</div>

		<span class="text-muted-foreground text-sm">Priority</span>
		<div>
			<PriorityPicker
				value={issue.priority}
				showLabel
				onchange={(priority: IssuePriority) => store.update(issue.id, { priority })}
			/>
		</div>

		<Label for="issue-assignee" class="text-muted-foreground font-normal">Assignee</Label>
		<Input
			id="issue-assignee"
			aria-label="Assignee"
			placeholder="Unassigned"
			value={assigneeDraft ?? issue.assignee ?? ''}
			oninput={(event) => (assigneeDraft = event.currentTarget.value)}
			onblur={commitAssignee}
			onkeydown={(event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					commitAssignee();
				}
				cancelOnEscape(event, assigneeDraft !== null, () => (assigneeDraft = null));
			}}
		/>

		<Label for="issue-labels" class="text-muted-foreground font-normal">Labels</Label>
		<Input
			id="issue-labels"
			aria-label="Labels"
			placeholder="comma, separated"
			value={labelsDraft ?? formatLabels(issue.labels)}
			oninput={(event) => (labelsDraft = event.currentTarget.value)}
			onblur={commitLabels}
			onkeydown={(event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					commitLabels();
				}
				cancelOnEscape(event, labelsDraft !== null, () => (labelsDraft = null));
			}}
		/>
	</div>

	{#if issue.labels.length > 0}
		<div class="flex flex-wrap gap-1">
			{#each issue.labels as label (label)}
				<Badge variant="secondary">{label}</Badge>
			{/each}
		</div>
	{/if}

	<p class="text-muted-foreground text-xs">
		Created <time datetime={isoTime(issue.createdAt)}>{relativeTime(issue.createdAt)}</time>
		· Updated <time datetime={isoTime(issue.updatedAt)}>{relativeTime(issue.updatedAt)}</time>
	</p>
</div>
