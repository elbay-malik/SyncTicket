<script lang="ts">
	// Who left the trace, as the same initials disc the presence bar draws for them.
	//
	// The wash alone says "someone" in a colour, and a colour on a row sits a few pixels from
	// the status glyph whose colour *is* the information. Several peer hues land within a
	// just-noticeable step of a status or urgent hue (light h≈140-180 beside Done emerald,
	// h≈45 beside In Progress amber), so a frame in one of them read as a status signal — a
	// green box round a Todo row looked like "done", an amber one like a warning. Initials are
	// the cue colour cannot be: a disc with "AL" in it is a person, whatever its hue, which is
	// exactly how the avatars already avoid the same collision.
	//
	// In flow beside the row's viewer stack, and on the same timeline as the wash (one shared
	// delay, one keyframe), so the two arrive and leave together. Decoration only, for the
	// same reason as the wash: the announcer has already said who.

	import { initialsOf } from '$lib/model/identity.js';
	import { traceDelay, type RemoteChange } from '$lib/state/remote-change.js';

	let { change }: { change: RemoteChange | undefined } = $props();
</script>

{#if change?.author}
	{#key change.at}
		<span
			class="peer-avatar peer-avatar-sm remote-trace-author shrink-0"
			style:--peer-h={change.author.hue}
			style:--trace-delay={traceDelay(change, Date.now())}
			data-remote-trace-author={change.author.name}
			aria-hidden="true"
		>
			{initialsOf(change.author.name)}
		</span>
	{/key}
{/if}
