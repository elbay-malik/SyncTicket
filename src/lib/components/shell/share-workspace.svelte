<script lang="ts">
	// The invitation. A workspace is private until its link is handed to someone, so this is
	// the whole sharing model: copy the URL, send it, and the other browser joins the same
	// Yjs room (ADR 0004).

	import CheckIcon from '@lucide/svelte/icons/check';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import LinkIcon from '@lucide/svelte/icons/link';
	import { workspaceShareUrl } from '$lib/model/workspace.js';
	import type { IssueStore } from '$lib/state/issues.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';

	let { store }: { store: IssueStore } = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	/** Empty during SSR, where there is no origin to build a link from. */
	const url = $derived(
		typeof location === 'undefined' ? '' : workspaceShareUrl(location.origin, store.workspaceId)
	);

	let failed = $state(false);

	async function copy() {
		if (!url) return;
		try {
			await navigator.clipboard.writeText(url);
		} catch {
			// Clipboard access can be refused (insecure context, denied permission). It used to
			// return silently here, which meant pressing the button did nothing at all and said
			// nothing about why — the worst available outcome, and indistinguishable from a dead
			// control. The link is still on the button's own `title`, so the message says where
			// to find it rather than only that something failed.
			failed = true;
			clearTimeout(timer);
			timer = setTimeout(() => (failed = false), 4000);
			return;
		}
		failed = false;
		copied = true;
		clearTimeout(timer);
		timer = setTimeout(() => (copied = false), 2000);
	}
</script>

<Button
	variant="ghost"
	size="sm"
	onclick={copy}
	title="Copy an invite link to this workspace"
	data-testid="share-workspace"
	data-share-url={url}
>
	{#if copied}
		<CheckIcon />
		Copied
	{:else if failed}
		<TriangleAlertIcon />
		Copy failed
	{:else}
		<LinkIcon />
		Share
	{/if}
</Button>
<!-- Announced rather than only drawn: the button's label changes, but a screen-reader user who
     pressed it and heard nothing would be in exactly the position this fixes. -->
<span class="sr-only" role="status" aria-live="polite">
	{failed ? 'Copy failed. The invite link is on the Share button as a tooltip.' : ''}
</span>
