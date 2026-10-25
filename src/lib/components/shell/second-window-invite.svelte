<script lang="ts">
	// The product demonstrating its own claim instead of asserting it. This used to be one 12px
	// sentence asking the visitor to "open this link in a second window" — at a time when the
	// address bar showed no link — which left the only proof of sync behind a copy, a new
	// window and a paste. Now the sentence carries the action that makes it true.
	//
	// When to show it is the caller's decision (relay ready, nobody else here); this only says
	// what it says and does what it offers, so the condition stays next to the rest of the
	// route's relay state.

	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { workspaceShareUrl } from '$lib/model/workspace.js';
	import { Button } from '$lib/components/ui/button/index.js';

	let { workspaceId }: { workspaceId: string } = $props();

	function openSecondWindow() {
		// The share URL rather than `location.href`: it is the link Share copies, so the second
		// window arrives exactly the way an invited person would, through `?ws=` and nothing this
		// browser happens to remember. `noopener` so the new window gets no handle back to this
		// one — it is a peer, not a child, and has no business scripting the first.
		window.open(workspaceShareUrl(location.origin, workspaceId), '_blank', 'noopener');
	}
</script>

<!-- Caption register, no card and no colour: a standing invitation rather than an alert, and the
     surrounding restraint is what lets the status colours read at all. The old sentence is kept
     with its first clause turned into the action, and the whole thing flows as prose rather
     than as a flex row: squeezed beside a fixed-width button the claim broke into four lines
     at 320px, where as one wrapping sentence it takes two. `leading-6` is the button's own
     height, so a line holding the button is no taller than a line without it. `text-balance`
     rather than `text-pretty`: Chromium's `pretty` only refuses a one-word last line, so at
     390px "even offline." still wrapped on its own under a full line. Balanced, the break falls
     at the dash at both 390 and 320, so the claim reads as one unbroken clause on line two. -->
<p
	class="text-muted-foreground -mt-2 text-xs leading-6 text-balance"
	data-testid="second-window-invite"
>
	<Button variant="outline" size="xs" class="align-top" onclick={openSecondWindow}>
		<ExternalLinkIcon data-icon="inline-start" />
		Open a second window
	</Button>
	— edits merge both ways, even offline.
</p>
