<script lang="ts">
	import type { IssueStore } from '$lib/state/issues.svelte.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import IssueCreateForm from './issue-create-form.svelte';

	let {
		store,
		open = $bindable(false),
		onOpenChange
	}: {
		store: IssueStore;
		open?: boolean;
		/** Optional observer; `open` stays two-way bindable for the layout. */
		onOpenChange?: (open: boolean) => void;
	} = $props();

	function setOpen(next: boolean) {
		open = next;
		onOpenChange?.(next);
	}
</script>

<Dialog.Root {open} onOpenChange={setOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>New issue</Dialog.Title>
			<Dialog.Description class="sr-only">
				Create an issue in this workspace. It is stored in your browser and works offline.
			</Dialog.Description>
		</Dialog.Header>
		<IssueCreateForm {store} onCreated={() => setOpen(false)} />
	</Dialog.Content>
</Dialog.Root>
