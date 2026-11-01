<script lang="ts" module>
	/** Which of the deliberately throwing children are live. */
	export const trap = $state({ rows: false, editor: false });
</script>

<script lang="ts">
	// Stands in for RemoteTrace, the one child both a list row and a board card render from a
	// single record's data, so a change to that one record is what sets it off. It throws the
	// way the audit's bug did: a real keyed {#each} meeting a repeated key during an update.
	import type { RemoteChange } from '$lib/state/remote-change.js';

	let { change }: { change: RemoteChange | undefined } = $props();
	const keys = $derived(trap.rows && change ? ['boom', 'boom'] : ['ok']);
</script>

{#each keys as key (key)}
	<span hidden>{key}</span>
{/each}
