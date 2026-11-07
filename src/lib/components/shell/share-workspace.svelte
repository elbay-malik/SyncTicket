<script lang="ts">
	// The invitation. A workspace is private until its link is handed to someone, so this is
	// the whole sharing model: copy the URL, send it, and the other browser joins the same
	// Yjs room (ADR 0004).

	import CheckIcon from '@lucide/svelte/icons/check';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import LinkIcon from '@lucide/svelte/icons/link';
	import { online } from 'svelte/reactivity/window';
	import { workspaceShareUrl } from '$lib/model/workspace.js';
	import type { IssueStore } from '$lib/state/issues.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';

	let { store }: { store: IssueStore } = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	/** Empty during SSR, where there is no origin to build a link from. */
	const url = $derived(
		typeof location === 'undefined' ? '' : workspaceShareUrl(location.origin, store.workspaceId)
	);

	/**
	 * True while the copy-it-yourself popover is open, and only then. The button's "Copy
	 * failed" label is tied to it rather than to a timer, so the label cannot clear while the
	 * fallback it refers to is still on screen, nor linger after it has gone.
	 */
	let failed = $state(false);
	/**
	 * True after a copy made while the relay can't be reached, until dismissed or reconnected.
	 * The link itself is fine, but the workspace only reaches it through the relay, so the
	 * person it is sent to could open an empty workspace. A plain "Copied" let them send it.
	 */
	let unsynced = $state(false);
	let open = $derived(failed || unsynced);
	/** Why the link can't carry the workspace now: the visitor's network, or the relay. */
	const cause = $derived(
		online.current === false ? "you're offline" : "this tab can't reach the sync server"
	);
	$effect(() => {
		if (store.connection !== 'offline') unsynced = false;
	});
	let button = $state<HTMLButtonElement | null>(null);
	let field = $state<HTMLInputElement | null>(null);
	let content = $state<HTMLElement | null>(null);

	async function copy() {
		if (!url) return;
		try {
			await navigator.clipboard.writeText(url);
		} catch {
			// Clipboard access can be refused (insecure context, denied permission, an embedded
			// frame). This once returned silently — a dead control — and then announced "the
			// link is on the Share button as a tooltip" while the button's title was a fixed
			// sentence with no link in it: a recovery hint pointing at nothing. Recovery is now
			// the link itself, in a field, already selected, so the next keystroke is the copy
			// the browser refused to do.
			clearTimeout(timer);
			copied = false;
			failed = true;
			return;
		}
		failed = false;
		unsynced = store.connection === 'offline';
		copied = true;
		clearTimeout(timer);
		timer = setTimeout(() => (copied = false), 2000);
	}
</script>

<!-- Controlled and trigger-less: the Share button is anchored to, not wired as a toggle,
     because on the ordinary path a click copies and must open nothing. -->
<Popover.Root
	bind:open={
		() => open,
		(value) => {
			if (value) return;
			failed = false;
			unsynced = false;
		}
	}
>
	<Button
		bind:ref={button}
		variant="ghost"
		size="sm"
		onclick={copy}
		title={failed ? url : 'Copy an invite link to this workspace'}
		data-testid="share-workspace"
		data-share-url={url}
	>
		{#if copied}
			<CheckIcon />
			Copied
		{:else if failed}
			<TriangleAlertIcon />
			Copy failed
		{:else}
			<LinkIcon />
			Share
		{/if}
	</Button>
	<!-- Not a focus trap. It is one read-only field, not a dialog, and bits-ui's trap pulled
	     focus back into the field on a click elsewhere — then the field unmounted under it, so
	     the click that dismissed the popover left focus on <body> instead of where it was aimed. -->
	<Popover.Content
		bind:ref={content}
		trapFocus={false}
		customAnchor={button}
		align="end"
		aria-label={failed ? 'Invite link' : 'Link not synced yet'}
		data-testid={failed ? 'share-fallback' : 'share-unsynced'}
		onOpenAutoFocus={(event) => {
			// Into the field, with the whole link selected: on a keyboard that is one ⌘C/Ctrl+C
			// away from done, and on a phone the selection handles are already up. The unsynced
			// note takes no focus: it is something to read, and the copy has already happened.
			event.preventDefault();
			if (!failed) return;
			field?.focus();
			field?.select();
		}}
		onCloseAutoFocus={(event) => {
			// There is no Popover.Trigger for bits-ui to return focus to, so it would land on
			// <body>. Back to the button that started this — but only when focus would otherwise
			// be lost: still in the closing popover, or already dropped to <body>. A click outside
			// both dismisses the popover and puts focus on what was clicked, and taking it back
			// sent the next keystrokes to Share, where global shortcuts fire ("b" for Board)
			// instead of the field the person had just chosen to type in.
			event.preventDefault();
			const active = document.activeElement;
			const lost = active === null || active === document.body || !!content?.contains(active);
			if (lost) button?.focus();
		}}
	>
		{#if failed}
			<p class="text-muted-foreground text-xs">
				This browser blocked copying. The link is selected below — copy it from here.
			</p>
			<Input
				bind:ref={field}
				value={url}
				readonly
				aria-label="Invite link"
				data-testid="share-fallback-url"
				onfocus={(event) => event.currentTarget.select()}
			/>
		{:else}
			<p class="text-xs">
				Link copied, but {cause} right now. Anyone who opens the link may not see what's here until this
				tab reconnects.
			</p>
		{/if}
	</Popover.Content>
</Popover.Root>
<!-- Announced rather than only drawn: the button's label changes, but a screen-reader user who
     pressed it and heard nothing would be in exactly the position this fixes. It says what is
     actually there — focus is already in the field, so this is the why, not a pointer. -->
<span class="sr-only" role="status" aria-live="polite">
	{failed
		? 'Copy failed. The invite link is selected in a text field, ready to copy.'
		: unsynced
			? `Link copied, but ${cause}, so whoever opens the link may not see what's here until this tab reconnects.`
			: ''}
</span>
