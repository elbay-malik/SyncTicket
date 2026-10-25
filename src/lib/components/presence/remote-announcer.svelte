<script lang="ts">
	// Says what peers just changed, to assistive technology only.
	//
	// The trace on a row is visual, and the row it marks has often just moved to another
	// section or out of the rendered window, so without this a screen-reader user would get
	// no sign at all that the workspace is shared — the one thing it exists to show. Polite,
	// never assertive: someone else's edit is news, not an emergency, and must not cut off
	// whatever this user is reading or typing. `AnnouncementQueue` coalesces bursts and drops
	// a peer's repeated typing commits; this component only owns the region.
	//
	// Only remote changes ever reach it — the store records nothing local — so this user's
	// own edits are never read back to them.

	import type { RemoteActivity } from '$lib/state/remote-activity.svelte.js';
	import { AnnouncementQueue } from '$lib/state/remote-change.js';

	let { activity }: { activity: RemoteActivity } = $props();

	let message = $state('');

	$effect(() => {
		let frame = 0;
		const queue = new AnnouncementQueue((text) => {
			// Emptied first and refilled a frame later, so two identical sentences in a row
			// ("Ada moved “Fix login” to Done", undone, redone) are both read: a live region
			// only speaks when its content changes.
			message = '';
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => (message = text));
		});
		const unsubscribe = activity.subscribe((change) => queue.push(change));
		return () => {
			unsubscribe();
			queue.destroy();
			cancelAnimationFrame(frame);
		};
	});
</script>

<!-- Mounted empty and kept mounted: a live region that is inserted along with its first
     message is not reliably announced, because nothing was being watched when it arrived. -->
<div
	role="status"
	aria-live="polite"
	aria-atomic="true"
	class="sr-only"
	data-testid="remote-announcer"
>
	{message}
</div>
