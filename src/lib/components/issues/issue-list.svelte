<script lang="ts">
	// The list is virtualized because the DOM is the only thing that does not scale here.
	// Measured at 10,000 issues before this change: filtering and sorting the whole set took
	// 2 ms and a single field edit reached the DOM in under 1 ms, but rendering every row
	// cost 5.0 s and 168,000 nodes. The Phase 3 query index was never the problem; the 17
	// nodes per row were.
	//
	// `Virtualizer` (rather than virtua's self-contained `VList`) because it lets the item
	// element be a real <li> inside a real <ul>: the rows keep their list semantics for
	// assistive technology, and every existing test that looks for a listitem still works.
	// Its scroll container is its direct parent, which is the bordered div below.

	import { Virtualizer } from 'virtua/svelte';
	import type { Issue } from '$lib/model/issue.js';
	import type { IssueStore } from '$lib/state/issues.svelte.js';
	import IssueRow from './issue-row.svelte';

	let { issues, store }: { issues: Issue[]; store: IssueStore } = $props();
</script>

<div class="h-full overflow-y-auto rounded-lg border" data-testid="issue-list">
	<Virtualizer
		data={issues}
		getKey={(issue: Issue) => issue.id}
		as="ul"
		item="li"
		itemProps={() => ({ class: 'border-b last:border-b-0' })}
	>
		{#snippet children(issue: Issue)}
			<IssueRow {issue} {store} />
		{/snippet}
	</Virtualizer>
</div>
