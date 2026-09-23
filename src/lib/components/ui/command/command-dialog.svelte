<script lang="ts">
	import type { Command as CommandPrimitive, Dialog as DialogPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import Command from './command.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

	let {
		open = $bindable(false),
		ref = $bindable(null),
		value = $bindable(''),
		title = 'Command Palette',
		description = 'Search for a command to run...',
		showCloseButton = false,
		portalProps,
		children,
		class: className,
		...restProps
	}: WithoutChildrenOrChild<DialogPrimitive.RootProps> &
		WithoutChildrenOrChild<CommandPrimitive.RootProps> & {
			portalProps?: DialogPrimitive.PortalProps;
			children: Snippet;
			title?: string;
			description?: string;
			showCloseButton?: boolean;
			class?: string;
		} = $props();
</script>

<Dialog.Root bind:open {...restProps}>
	<Dialog.Content
		class={cn('rounded-xl! top-1/3 translate-y-0 overflow-hidden p-0', className)}
		{showCloseButton}
		{portalProps}
	>
		<!--
			The header belongs inside the content, not beside it: Dialog.Content is gated on `open`
			but Dialog.Root renders its other children unconditionally, so as a sibling this put a
			level-2 heading and its description into every page's accessible tree — ahead of the
			page's own h1 — for a palette that was shut. bits-ui's Title sets root.titleId in its
			constructor and Content reads it through a $derived, so aria-labelledby still resolves
			from in here (and this is what every other dialog in the app already does).
		-->
		<Dialog.Header class="sr-only">
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>
		<Command {...restProps} bind:value bind:ref {children} />
	</Dialog.Content>
</Dialog.Root>
