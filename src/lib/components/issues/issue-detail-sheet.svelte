<script lang="ts">
	// Shell for the issue detail view: open/close, the three load states, and delete. The
	// editable fields live in issue-editor.svelte, re-created per issue id so drafts never
	// outlive the issue they belong to.

	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import type { IssueStore } from '$lib/state/issues.svelte.js';
	import { getPresence } from '$lib/state/presence.svelte.js';
	import { listNames } from '$lib/format.js';
	import PeerAvatars from '$lib/components/presence/peer-avatars.svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import IssueEditor from './issue-editor.svelte';

	let {
		store,
		id,
		open = true,
		onOpenChange
	}: {
		store: IssueStore;
		id: string;
		open?: boolean;
		onOpenChange: (open: boolean) => void;
	} = $props();

	const issue = $derived(store.get(id));

	// The one place presence earns its keep: this is where two people overwrite each other's
	// words, so here it is visible text rather than a row of silent avatars.
	const presence = $derived(getPresence(store));
	const viewers = $derived(presence.viewersOf(id));
	const viewerSentence = $derived(
		`${listNames(viewers.map((peer) => peer.name))} ${
			viewers.length === 1 ? 'is' : 'are'
		} also viewing this issue`
	);

	let confirmOpen = $state(false);
	let cancelRef = $state<HTMLButtonElement | null>(null);
	// Set between "delete confirmed" and the route change completing. Without it the sheet
	// would render its not-found branch for a frame, flashing "Issue not found" on the way
	// out of a perfectly ordinary delete.
	let deleting = $state(false);

	/** Accessible name for the dialog in every state (bits-ui names it from Sheet.Title). */
	const title = $derived(!store.synced ? 'Loading issue' : (issue?.title ?? 'Issue not found'));

	function confirmDelete() {
		confirmOpen = false;
		deleting = true;
		onOpenChange(false);
		store.remove(id);
	}
</script>

<Sheet.Root {open} onOpenChange={(next: boolean) => onOpenChange(next)}>
	<Sheet.Content
		side="right"
		class="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-lg"
		data-testid="issue-sheet"
	>
		<Sheet.Header class="pb-2">
			<Sheet.Title class="sr-only">{title}</Sheet.Title>
			<Sheet.Description class="sr-only">
				Edit this issue's fields. Changes save as you go and are stored in your browser.
			</Sheet.Description>
		</Sheet.Header>

		{#if viewers.length > 0}
			<div
				class="text-muted-foreground flex items-center gap-2 px-4 pb-2 text-xs"
				data-testid="sheet-viewers"
			>
				<PeerAvatars peers={viewers} max={3} size="sm" summary="" />
				<span>{viewerSentence}</span>
			</div>
		{/if}

		{#if !store.synced}
			<div class="flex flex-col gap-4 px-4 pb-4" data-testid="issue-sheet-loading">
				<Skeleton class="h-9 w-2/3" />
				<Skeleton class="h-32 w-full" />
				<Skeleton class="h-8 w-1/2" />
			</div>
		{:else if issue}
			{#key issue.id}
				<IssueEditor {issue} {store} />
			{/key}

			<div class="mt-auto flex items-center justify-end border-t px-4 py-3">
				<Button variant="destructive" size="sm" onclick={() => (confirmOpen = true)}>
					<Trash2Icon />
					Delete
				</Button>
			</div>
		{:else if !deleting}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
				<p class="text-base font-medium">Issue not found</p>
				<p class="text-muted-foreground max-w-xs text-sm">
					It may have been deleted, or this link points at another workspace.
				</p>
				<Button variant="outline" size="sm" onclick={() => onOpenChange(false)}>
					Back to issues
				</Button>
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>

<AlertDialog.Root bind:open={confirmOpen}>
	<AlertDialog.Content
		onOpenAutoFocus={(event: Event) => {
			// bits-ui focuses the content container by default. For a destructive prompt the
			// least-destructive action should hold focus (WAI-ARIA APG), so Enter cannot
			// delete by reflex.
			event.preventDefault();
			requestAnimationFrame(() => cancelRef?.focus());
		}}
	>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete issue?</AlertDialog.Title>
			<AlertDialog.Description>
				This permanently removes “{issue?.title ?? 'this issue'}” from the workspace. Other
				collaborators will see it disappear.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel bind:ref={cancelRef}>Cancel</AlertDialog.Cancel>
			<!-- AlertDialog.Action does not close the dialog on its own in bits-ui 2.x. -->
			<AlertDialog.Action variant="destructive" onclick={confirmDelete}>
				Delete issue
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
