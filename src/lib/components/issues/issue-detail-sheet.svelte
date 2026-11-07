<script lang="ts">
	// Shell for the issue detail view: open/close, the three load states, and delete. The
	// editable fields live in issue-editor.svelte, re-created per issue id so drafts never
	// outlive the issue they belong to.

	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { online } from 'svelte/reactivity/window';
	import type { IssueStore } from '$lib/state/issues.svelte.js';
	import { getPresence } from '$lib/state/presence.svelte.js';
	import { listNames } from '$lib/format.js';
	import PeerAvatars from '$lib/components/presence/peer-avatars.svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import ViewBoundary from '$lib/components/shell/view-boundary.svelte';
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

	/**
	 * Which of the states without an issue to show. `synced` is only the local database, and
	 * on a shared link that is empty: the issue is still on its way from the relay. Deciding
	 * "not found" from it told everyone opening a shared deep link that the issue may have been
	 * deleted, for as long as the round trip took, and for good when the relay was unreachable.
	 * So "not found" waits for `settled`, and a relay that can't be reached says so instead.
	 */
	const absence = $derived.by((): 'loading' | 'unreachable' | 'missing' => {
		if (store.settled) return 'missing';
		return store.synced && store.connection === 'offline' ? 'unreachable' : 'loading';
	});
	const unreachableCause = $derived(
		online.current === false ? "You're offline" : "The sync server can't be reached"
	);
	/**
	 * Said rather than only drawn: the sheet opens while it waits, so by the time the issue, or
	 * the news that it can't be had, arrives, the dialog has already been announced as "Loading
	 * issue" and nothing else would tell a screen-reader user it changed.
	 */
	let waited = $state(false);
	$effect(() => {
		if (!issue && !deleting) waited = true;
	});
	const announcement = $derived.by(() => {
		if (!waited || deleting) return '';
		if (issue) return 'Issue loaded.';
		if (absence === 'unreachable') return `This issue isn't on this device. ${unreachableCause}.`;
		return absence === 'missing' ? 'Issue not found.' : '';
	});

	/** Accessible name for the dialog in every state (bits-ui names it from Sheet.Title). */
	const title = $derived(
		issue?.title ??
			(absence === 'missing'
				? 'Issue not found'
				: absence === 'unreachable'
					? "Issue isn't on this device"
					: 'Loading issue')
	);

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
		onCloseAutoFocus={(event: Event) => {
			// There is no Sheet.Trigger to restore focus to — this sheet is a route, reached by
			// a link or by pasting a URL — so bits-ui's restore either does nothing or aims at
			// whatever happened to be focused when the route changed. Declining it leaves the
			// route's own afterNavigate (src/routes/issues/+layout.svelte) as the single owner
			// of where focus lands, which is the row this sheet was opened from.
			event.preventDefault();
		}}
	>
		<Sheet.Header class="pb-2">
			<Sheet.Title class="sr-only">{title}</Sheet.Title>
			<Sheet.Description class="sr-only">
				Edit this issue's fields. Changes save as you go and are stored in your browser.
			</Sheet.Description>
		</Sheet.Header>

		<span class="sr-only" role="status" aria-live="polite">{announcement}</span>

		{#if viewers.length > 0}
			<div
				class="text-muted-foreground flex items-center gap-2 px-4 pb-2 text-xs"
				data-testid="sheet-viewers"
			>
				<PeerAvatars peers={viewers} max={3} size="sm" summary="" />
				<span>{viewerSentence}</span>
			</div>
		{/if}

		{#if issue}
			<!-- Around the editor alone, inside the dialog: the dialog keeps its name, its Close and
			     its focus trap, and Delete below stays reachable, which is the one way out of a record
			     that cannot render. The key is outside so another issue starts clean rather than
			     showing this one's failure. -->
			{#key issue.id}
				<ViewBoundary title="This issue couldn’t be shown" class="flex-1 p-8">
					<IssueEditor {issue} {store} />
				</ViewBoundary>
			{/key}

			<div class="mt-auto flex items-center justify-end border-t px-4 py-3">
				<Button variant="destructive" size="sm" onclick={() => (confirmOpen = true)}>
					<Trash2Icon />
					Delete
				</Button>
			</div>
		{:else if deleting}
			<!-- Nothing: the route is changing away, and anything here would flash on the way out. -->
		{:else if absence === 'loading'}
			<div class="flex flex-col gap-4 px-4 pb-4" data-testid="issue-sheet-loading">
				<Skeleton class="h-9 w-2/3" />
				<Skeleton class="h-32 w-full" />
				<Skeleton class="h-8 w-1/2" />
			</div>
		{:else if absence === 'unreachable'}
			<div
				class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
				data-testid="issue-sheet-unreachable"
			>
				<p class="text-base font-medium">This issue isn't on this device</p>
				<!-- Not "it will appear": it may have been deleted, and only the relay can say. -->
				<p class="text-muted-foreground max-w-xs text-sm">
					{unreachableCause}, so this device can't ask the sync server for it yet. If it was shared
					with you, it will appear here once {online.current === false
						? "you're back online"
						: "the server's reachable"}; if it was deleted, it won't.
				</p>
				<Button variant="outline" size="sm" onclick={() => onOpenChange(false)}>
					Back to issues
				</Button>
			</div>
		{:else}
			<div
				class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
				data-testid="issue-sheet-missing"
			>
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
