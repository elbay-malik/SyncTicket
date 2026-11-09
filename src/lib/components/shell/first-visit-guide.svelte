<script lang="ts">
	// The "Try this" card: the two things that make the demo worth seeing — sync between windows
	// and editing offline — are the two a visitor in a hurry never finds unaided, and search is
	// the third. A corner card, never a dialog: no backdrop, it does not take focus when it
	// appears on its own, and being `fixed` it moves nothing on the page.
	//
	// Step one carries its own buttons rather than naming the issues page's: the card shows on
	// every route, and the empty state's "Load example issues" and the second-window invite only
	// exist on one of them, in some states.
	//
	// Esc closes it from inside, and only from inside, so it never competes with the dialogs and
	// the palette for a key they already answer.

	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import XIcon from '@lucide/svelte/icons/x';
	import { tick } from 'svelte';
	import { workspaceShareUrl } from '$lib/model/workspace.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { closeGuide, dismissGuide, guide } from '$lib/state/guide.svelte.js';

	let {
		ready,
		empty,
		paletteHint,
		workspaceId,
		onLoadExamples
	}: {
		/**
		 * The workspace has settled. Until then whether it is empty is not known, and a card that
		 * opened first would rewrite its first step under the reader a moment later.
		 */
		ready: boolean;
		/** Settled with no issues, so step one offers to load the examples first. */
		empty: boolean;
		/** ⌘K or Ctrl+K, from the shortcut registry; empty before it has registered. */
		paletteHint: string;
		/** For the second window, opened on the share link the way an invited person arrives. */
		workspaceId: string;
		onLoadExamples: () => void;
	} = $props();

	const searchStep = $derived(
		paletteHint
			? `Search with ${paletteHint}, or from Search in the sidebar.`
			: 'Search from the sidebar.'
	);

	let card = $state<HTMLElement | null>(null);
	/**
	 * Below `sm` the card starts as one line, so on a phone it never covers what its own steps
	 * point at; from `sm` it is always open, and this is ignored.
	 */
	let expanded = $state(false);

	// Asked for (the header button, the palette), not appeared on its own: then the card opens
	// fully and takes focus, so a keyboard or screen-reader user lands on what they asked for.
	$effect(() => {
		if (!guide.open || !guide.focusOnOpen || !card) return;
		guide.focusOnOpen = false;
		expanded = true;
		card.focus();
	});

	function openSecondWindow() {
		// Same as the issues page's invite: the share link, as a peer rather than a child window.
		window.open(workspaceShareUrl(location.origin, workspaceId), '_blank', 'noopener');
	}

	// Closed from inside, focus would otherwise fall to <body>, the top of the page.
	async function leave(close: () => void) {
		const hadFocus = card?.contains(document.activeElement) ?? false;
		close();
		expanded = false;
		await tick();
		if (hadFocus) document.getElementById('main-content')?.focus();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		event.stopPropagation();
		void leave(closeGuide);
	}
</script>

{#if guide.open && ready}
	<!-- Last in the page, so it is the last thing in the tab order and its heading follows the
	     page's. Below the remote-change notice (z-40), which is brief and says something that
	     just happened, and below dialogs and the phone's sidebar sheet. A floating layer in
	     DESIGN.md's vocabulary: `shadow-md` with the ring doing the edge. On a phone a strip
	     across the bottom; from `sm` a 20rem card in the corner. Never taller than the space
	     under the header, scrolling inside instead. `tabindex="-1"`: focusable when asked for,
	     never a tab stop of its own. -->
	<!-- Esc bubbling up from the card's own buttons: the region listens, it is not a control. -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<aside
		bind:this={card}
		aria-labelledby="first-visit-guide-title"
		tabindex="-1"
		{onkeydown}
		data-testid="first-visit-guide"
		class="bg-popover text-popover-foreground ring-foreground/10 focus-visible:ring-ring fixed inset-x-3 bottom-3 z-30 max-h-[calc(100svh-4.5rem)] overflow-y-auto rounded-lg p-4 shadow-md ring-1 outline-hidden focus-visible:ring-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:max-h-[calc(100svh-5rem)] sm:w-80"
	>
		<div class="flex items-center justify-between gap-2">
			<h2 id="first-visit-guide-title" class="text-sm font-semibold">Try this</h2>
			<div class="-my-1 -mr-2 flex items-center gap-1">
				<Button
					variant="ghost"
					size="sm"
					class="sm:hidden"
					aria-expanded={expanded}
					aria-controls="first-visit-guide-body"
					onclick={() => (expanded = !expanded)}
				>
					{expanded ? 'Hide' : 'Show'}
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Close the guide"
					onclick={() => leave(closeGuide)}
				>
					<XIcon />
				</Button>
			</div>
		</div>
		<div id="first-visit-guide-body" class={[!expanded && 'hidden', 'sm:block']}>
			<ol class="mt-2 list-decimal space-y-2 pl-5 text-sm">
				<li>
					<strong class="font-medium">See it sync.</strong> Change an issue in one window, and the
					other shows it within a second.
					<span class="mt-1.5 flex flex-wrap gap-1.5">
						{#if empty}
							<Button variant="outline" size="xs" onclick={onLoadExamples}>
								<SparklesIcon data-icon="inline-start" />
								Load example issues
							</Button>
						{/if}
						<Button variant="outline" size="xs" onclick={openSecondWindow}>
							<ExternalLinkIcon data-icon="inline-start" />
							Open a second window
						</Button>
					</span>
				</li>
				<li>
					<strong class="font-medium">Go offline.</strong> Turn off Wi-Fi and keep editing: everything
					still works, and it's saved on this device. Back online, your changes reach everyone with the
					link.
				</li>
				<li>
					<strong class="font-medium">{searchStep}</strong>
					It runs in your browser. <em>Add meaning search</em> downloads about 46 MB once.
				</li>
			</ol>
			<p class="text-muted-foreground mt-3 text-xs">
				Sync goes through a relay. If it can't be reached, changes stay on this device until it can.
				Many connections in a few seconds are briefly refused.
			</p>
			<div class="mt-3 flex justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={() => leave(dismissGuide)}
					>Don't show again</Button
				>
				<Button variant="outline" size="sm" onclick={() => leave(closeGuide)}>Close</Button>
			</div>
		</div>
	</aside>
{/if}
