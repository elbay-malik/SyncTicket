<script lang="ts" module>
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
	// null. Drafts are set from DOM events only, never from an effect, so there is no
	// state-syncing loop to get wrong. (The one pair of effects, `keepSelection`, touches
	// only the DOM selection.)
	//
	// Title and description also commit while you type, after `IDLE_COMMIT_MS` without a
	// keystroke. Committing only on blur meant a peer watching saw nothing at all until you
	// left the field — in a product whose whole claim is that edits arrive live, the most
	// visible field was the one that did not. The draft stays non-null across those idle
	// commits, so the input keeps showing exactly what was typed (patchIssue trims a title,
	// and swapping to the trimmed live value would eat the space you just typed before the
	// next word) and a remote change cannot rewrite the field under the caret.
	//
	// Only while there is something new in it, though. Once an idle commit has stored the
	// draft and nothing has been typed since, the draft says nothing the document does not
	// already have. If a peer then changes the field, the input shows their value, and leaving
	// the field writes nothing. Otherwise the field went on showing your older text, and
	// blurring wrote it back over the peer's newer one, without a keystroke.
	//
	// A value that lands while the field is focused also keeps the selection. Assigning
	// `value` puts the caret at the end, so someone who had selected the title to type over
	// it typed onto the end of the peer's text instead ("Alice's editBob's edit").
	//
	// That turns one edit into several writes, which changes two things that used to be free:
	// - **Undo.** The UndoManager groups by time, so every pause would be its own step. Each
	//   field's run of writes, from first keystroke to blur/Enter/Escape, shares one
	//   `EditGroup`, and the store merges a group into a single undo step (see `update`).
	// - **Escape.** It used to discard a draft nothing had seen. Now part of the draft may
	//   already be in the document — and on a peer's screen — so reverting means restoring
	//   the value the field had when the run began. `revertEdit` does that by undoing the run's
	//   own step, which also means ⌘⇧Z brings back what Escape threw away.

	import { onDestroy, untrack } from 'svelte';
	import type { Issue, IssuePriority, IssueStatus } from '$lib/model/issue.js';
	import { formatLabels, parseLabels } from '$lib/model/labels.js';
	import { isoTime, relativeTime } from '$lib/format.js';
	import type { EditGroup, IssueStore } from '$lib/state/issues.svelte.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import PriorityPicker from './priority-picker.svelte';
	import StatusPicker from './status-picker.svelte';
	import { mapSelection } from './keep-selection.js';

	/**
	 * Idle time before a text field commits what has been typed so far.
	 *
	 * Long enough that a steady typist (a keystroke every 150-250ms) is never interrupted
	 * mid-word, short enough that a peer sees the words appear as each one is finished.
	 */
	export const IDLE_COMMIT_MS = 400;
</script>

<script lang="ts">
	let { issue, store }: { issue: Issue; store: IssueStore } = $props();

	// The issue this editor was created for, and the only thing a write may go by. `issue` is a live
	// getter on the parent, and blur and onDestroy both run as the editor is being taken down, by
	// when it may be undefined (a peer deleted the issue, or overwrote its entry) or already the
	// next issue (the sheet moved on, and the draft would land on that one).
	const id = untrack(() => issue.id);

	type LiveField = 'title' | 'description';
	type Direction = 'forward' | 'backward' | 'none';

	let titleDraft = $state<string | null>(null);
	let descriptionDraft = $state<string | null>(null);
	let assigneeDraft = $state<string | null>(null);
	let labelsDraft = $state<string | null>(null);

	/**
	 * One field's run of typing: its undo group, the value it started from, and the pending
	 * idle commit. Plain objects, not `$state` — nothing renders them.
	 */
	interface Run {
		group: EditGroup;
		original: string;
		timer: ReturnType<typeof setTimeout> | null;
	}
	const runs: Record<LiveField, Run | null> = { title: null, description: null };

	/**
	 * Per field: what this run's last write stored (after patchIssue's trim), and whether
	 * anything has been typed since. Rendered through `shown`, so `$state`.
	 */
	const stored = $state<Record<LiveField, string | null>>({ title: null, description: null });
	const typedSinceWrite = $state<Record<LiveField, boolean>>({ title: false, description: false });

	/**
	 * What a text field shows: the draft, unless the draft is already stored and a peer has
	 * changed the field since, in which case the peer's value.
	 */
	function shown(field: LiveField): string {
		const draft = draftOf(field);
		if (draft === null) return issue[field];
		const superseded =
			!typedSinceWrite[field] && stored[field] !== null && issue[field] !== stored[field];
		return superseded ? issue[field] : draft;
	}

	function endRun(field: LiveField) {
		runs[field] = null;
		setDraft(field, null);
		stored[field] = null;
		typedSinceWrite[field] = false;
	}

	function draftOf(field: LiveField): string | null {
		return field === 'title' ? titleDraft : descriptionDraft;
	}

	function setDraft(field: LiveField, value: string | null) {
		if (field === 'title') titleDraft = value;
		else descriptionDraft = value;
	}

	/** A keystroke: keep the draft, open a run if none is open, and restart the idle clock. */
	function type(field: LiveField, value: string) {
		setDraft(field, value);
		typedSinceWrite[field] = true;
		let run = runs[field];
		if (!run) {
			run = { group: store.beginEdit(), original: issue[field], timer: null };
			runs[field] = run;
		}
		if (run.timer !== null) clearTimeout(run.timer);
		run.timer = setTimeout(() => write(field), IDLE_COMMIT_MS);
	}

	/** Writes the draft into the run's undo step, without ending the run. */
	function write(field: LiveField) {
		const run = runs[field];
		const next = draftOf(field);
		if (!run || next === null) return;
		if (run.timer !== null) clearTimeout(run.timer);
		run.timer = null;
		// Nothing typed since the last write: writing again would put this older text back
		// over whatever a peer has written since.
		if (!typedSinceWrite[field]) return;
		// A blank title is dropped by patchIssue (a stored '' would render forever), so an idle
		// commit of an emptied field writes nothing and the field keeps showing the blank draft.
		if (dropped(field)) return;
		store.update(id, { [field]: next }, run.group);
		stored[field] = field === 'title' ? next.trim() : next;
		typedSinceWrite[field] = false;
	}

	/**
	 * A draft patchIssue would drop: a blank title. Ending a run on one cannot just write and
	 * return to the live value, because the live value is no longer the title the run began
	 * from — an idle commit may already have stored a fragment ("Fi") that the person then
	 * went on to delete. Snapping back to that would keep, and broadcast, a title nobody
	 * finished typing.
	 */
	function dropped(field: LiveField): boolean {
		return field === 'title' && draftOf(field)?.trim() === '';
	}

	/** Blur, Enter or ⌘Enter: write whatever is left and end the run. */
	function commit(field: LiveField) {
		// Emptying the title is a cancel, so it ends the way Escape does: back to the value the
		// run started from, with any fragment the run already stored taken back out.
		if (dropped(field)) return revert(field);
		write(field);
		endRun(field);
	}

	/**
	 * Escape: put the field back to what it was when this run began, writing it back if any
	 * of the run already reached the document.
	 */
	function revert(field: LiveField) {
		const run = runs[field];
		endRun(field);
		if (!run) return;
		if (run.timer !== null) clearTimeout(run.timer);
		// The fallback only runs when the run's step is no longer on top of the undo stack —
		// something else was undone or done in between — and then writing the old value is the
		// only way back. It is an ordinary write, so it is its own undo step.
		if (!store.revertEdit(run.group)) store.update(id, { [field]: run.original });
	}

	const commitTitle = () => commit('title');
	const commitDescription = () => commit('description');

	function commitAssignee() {
		const next = assigneeDraft;
		assigneeDraft = null;
		if (next !== null) store.update(id, { assignee: next.trim() || null });
	}

	function commitLabels() {
		const next = labelsDraft;
		labelsDraft = null;
		if (next !== null) store.update(id, { labels: parseLabels(next) });
	}

	/**
	 * Escape reverts the field being edited and keeps focus, then stops propagating so the
	 * sheet stays open. bits-ui listens for Escape on the document in the bubble phase, so
	 * a second Escape — with the draft now null — reaches it and closes the sheet.
	 */
	let titleInput = $state<HTMLInputElement | null>(null);
	let descriptionInput = $state<HTMLTextAreaElement | null>(null);
	let assigneeInput = $state<HTMLInputElement | null>(null);
	let labelsInput = $state<HTMLInputElement | null>(null);

	const titleShown = $derived(shown('title'));
	const descriptionShown = $derived(shown('description'));
	const assigneeShown = $derived(assigneeDraft ?? issue.assignee ?? '');
	const labelsShown = $derived(labelsDraft ?? formatLabels(issue.labels));

	/**
	 * Keeps a focused field's selection when a new value is put into it: the pre-effect runs
	 * before the DOM update and notes the selection, the effect puts it back afterwards, moved
	 * along with the text around it (see `mapSelection`).
	 */
	function keepSelection(
		element: () => HTMLInputElement | HTMLTextAreaElement | null,
		value: () => string
	) {
		let saved: { text: string; start: number; end: number; direction: Direction } | null = null;
		$effect.pre(() => {
			value();
			const el = untrack(element);
			saved = null;
			if (!el || document.activeElement !== el) return;
			const start = el.selectionStart ?? 0;
			saved = {
				text: el.value,
				start,
				end: el.selectionEnd ?? start,
				direction: el.selectionDirection ?? 'none'
			};
		});
		$effect(() => {
			value();
			const el = untrack(element);
			const before = saved;
			saved = null;
			if (!el || !before || el.value === before.text || document.activeElement !== el) return;
			const { start, end } = mapSelection(before.text, el.value, before);
			el.setSelectionRange(start, end, before.direction);
		});
	}

	keepSelection(
		() => titleInput,
		() => titleShown
	);
	keepSelection(
		() => descriptionInput,
		() => descriptionShown
	);
	keepSelection(
		() => assigneeInput,
		() => assigneeShown
	);
	keepSelection(
		() => labelsInput,
		() => labelsShown
	);

	function cancelOnEscape(event: KeyboardEvent, isEditing: boolean, revert: () => void) {
		if (event.key !== 'Escape' || !isEditing) return;
		revert();
		event.stopPropagation();
	}

	// Closing the sheet by clicking the overlay, pressing Back, or navigating away unmounts
	// this component without ever firing `blur`, so an uncommitted draft would be lost.
	// Flushing on destroy makes "it saved what I typed" true on every close path.
	onDestroy(() => {
		// Through the run, so what was typed before closing stays one undo step with the idle
		// commits already made — and the timer goes with it rather than firing on a dead editor.
		// A blank title is cancelled rather than flushed, for the reason `commit` gives.
		if (dropped('title')) revert('title');
		else write('title');
		write('description');
		for (const run of Object.values(runs)) if (run?.timer != null) clearTimeout(run.timer);
		if (assigneeDraft !== null) store.update(id, { assignee: assigneeDraft.trim() || null });
		if (labelsDraft !== null) store.update(id, { labels: parseLabels(labelsDraft) });
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
			bind:ref={titleInput}
			value={titleShown}
			oninput={(event) => type('title', event.currentTarget.value)}
			onblur={commitTitle}
			onkeydown={(event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					commitTitle();
				}
				cancelOnEscape(event, titleDraft !== null, () => revert('title'));
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
			bind:ref={descriptionInput}
			value={descriptionShown}
			oninput={(event) => type('description', event.currentTarget.value)}
			onblur={commitDescription}
			onkeydown={(event) => {
				// Enter inserts a newline here; ⌘/Ctrl+Enter is the explicit "save" gesture.
				if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
					event.preventDefault();
					commitDescription();
				}
				cancelOnEscape(event, descriptionDraft !== null, () => revert('description'));
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
		<!-- `min-w-0` for the same reason the track is `minmax(0,1fr)`: without it the picker's
		     intrinsic width wins and the button overshoots the sheet's right edge by ~1px at
		     320px. Measured, not theoretical. -->
		<div class="min-w-0">
			<StatusPicker
				value={issue.status}
				showLabel
				onchange={(status: IssueStatus) => store.update(id, { status })}
			/>
		</div>

		<span class="text-muted-foreground text-sm">Priority</span>
		<div class="min-w-0">
			<PriorityPicker
				value={issue.priority}
				showLabel
				onchange={(priority: IssuePriority) => store.update(id, { priority })}
			/>
		</div>

		<Label for="issue-assignee" class="text-muted-foreground font-normal">Assignee</Label>
		<Input
			id="issue-assignee"
			aria-label="Assignee"
			placeholder="Unassigned"
			bind:ref={assigneeInput}
			value={assigneeShown}
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
			bind:ref={labelsInput}
			value={labelsShown}
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
