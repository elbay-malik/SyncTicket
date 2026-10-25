<script lang="ts">
	// The trace a peer's edit leaves on the row or card it changed. The parent must be
	// `relative isolate`; this fills it, beneath the parent's content. See `.remote-trace` in
	// layout.css for the look.
	//
	// Decoration only — aria-hidden, because a screen reader hears the same event from the
	// announcer's live region, said once and coalesced, rather than once per rendered row.

	import { traceDelay, type RemoteChange } from '$lib/state/remote-change.js';

	let { change }: { change: RemoteChange | undefined } = $props();
</script>

{#if change}
	<!-- Keyed on the arrival time, so a second edit inside the window restarts the trace —
	     from full strength, see `traceDelay` — instead of being swallowed by the first's fade. -->
	{#key change.at}
		<span
			class="remote-trace"
			class:remote-trace-anon={!change.author}
			style:--peer-h={change.author?.hue ?? 0}
			style:--trace-delay={traceDelay(change, Date.now())}
			data-remote-trace={change.kind}
			data-remote-author={change.author?.name ?? ''}
			aria-hidden="true"
		></span>
	{/key}
{/if}
