<script lang="ts">
	// The list route as SvelteKit composes it: the real layout, with the real sheet as its page.
	import IssueDetailSheet from '$lib/components/issues/issue-detail-sheet.svelte';
	import type { IssueStore } from '$lib/state/issues.svelte.js';
	import IssuesLayout from '../../../routes/issues/+layout.svelte';

	let {
		store,
		openId = null,
		onOpenChange = () => {}
	}: {
		store: IssueStore;
		openId?: string | null;
		onOpenChange?: (open: boolean) => void;
	} = $props();
</script>

<IssuesLayout>
	{#if openId}
		<IssueDetailSheet {store} id={openId} {onOpenChange} />
	{/if}
</IssuesLayout>
