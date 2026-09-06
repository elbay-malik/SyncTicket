<script lang="ts">
	// The invitation. A workspace is private until its link is handed to someone, so this is
	// the whole sharing model: copy the URL, send it, and the other browser joins the same
	// Yjs room (ADR 0004).

	import CheckIcon from '@lucide/svelte/icons/check';
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

	async function copy() {
		if (!url) return;
		try {
			await navigator.clipboard.writeText(url);
		} catch {
			// Clipboard access can be refused (insecure context, denied permission). The link is
			// on the button as a title and in the DOM, so it is still recoverable by hand.
			return;
		}
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
	{:else}
		<LinkIcon />
		Share
	{/if}
</Button>
