<script lang="ts">
	// The detail sheet is a route, not component state: it is shareable, survives a reload,
	// and the browser Back button closes it. Closing replaces the history entry so Back
	// doesn't immediately reopen the sheet the user just dismissed.
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import IssueDetailSheet from '$lib/components/issues/issue-detail-sheet.svelte';
	import { getIssueStore } from '$lib/state/issues.svelte.js';

	const store = getIssueStore();
	const id = $derived(page.params.id ?? '');

	function close() {
		// keepFocus lets the sheet's focus scope restore focus to the row link it came from
		// instead of SvelteKit resetting focus to <body>.
		void goto(resolve('/issues'), { replaceState: true, keepFocus: true, noScroll: true });
	}
</script>

<IssueDetailSheet {store} {id} onOpenChange={(open) => !open && close()} />
