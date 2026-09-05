<script lang="ts">
	// The create form's fields. Rendered *inside* Dialog.Content, which bits-ui unmounts
	// when the dialog closes — so every open starts from a genuinely fresh component and a
	// cancelled draft cannot leak into the next one. (A {#key open} block would not do this:
	// it re-creates DOM, not the enclosing component's state.)

	import {
		DEFAULT_PRIORITY,
		DEFAULT_STATUS,
		type IssuePriority,
		type IssueStatus
	} from '$lib/model/issue.js';
	import type { IssueStore } from '$lib/state/issues.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Kbd } from '$lib/components/ui/kbd/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import PriorityPicker from './priority-picker.svelte';
	import StatusPicker from './status-picker.svelte';

	let { store, onCreated }: { store: IssueStore; onCreated: (id: string) => void } = $props();

	let title = $state('');
	let description = $state('');
	let status = $state<IssueStatus>(DEFAULT_STATUS);
	let priority = $state<IssuePriority>(DEFAULT_PRIORITY);
	let form = $state<HTMLFormElement | null>(null);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		// Not just cosmetic: requestSubmit() ignores the submit button's disabled state, so
		// the ⌘/Ctrl+Enter path reaches here with a blank title unless we check again.
		const trimmed = title.trim();
		if (!trimmed) return;
		onCreated(store.create({ title: trimmed, description, status, priority }));
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.isComposing) return;
		// preventDefault matters: Chromium also performs native implicit submission for
		// Ctrl/Meta+Enter in a text input, which would submit the form twice.
		event.preventDefault();
		form?.requestSubmit();
	}
</script>

<!-- The keydown handler implements a form-wide submit shortcut, not a click target. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<form bind:this={form} onsubmit={submit} onkeydown={onKeydown} class="flex flex-col gap-4">
	<div class="flex flex-col gap-1.5">
		<Label for="new-issue-title">Title</Label>
		<Input id="new-issue-title" aria-label="Title" placeholder="Issue title" bind:value={title} />
	</div>

	<div class="flex flex-col gap-1.5">
		<Label for="new-issue-description">Description</Label>
		<Textarea
			id="new-issue-description"
			aria-label="Description"
			rows={4}
			placeholder="Add a description…"
			bind:value={description}
		/>
	</div>

	<div class="flex flex-wrap items-center gap-2">
		<StatusPicker value={status} showLabel onchange={(next: IssueStatus) => (status = next)} />
		<PriorityPicker
			value={priority}
			showLabel
			onchange={(next: IssuePriority) => (priority = next)}
		/>
	</div>

	<Dialog.Footer>
		<Dialog.Close>
			{#snippet child({ props })}
				<Button {...props} variant="outline">Cancel</Button>
			{/snippet}
		</Dialog.Close>
		<Button type="submit" disabled={!title.trim()}>
			Create issue
			<Kbd aria-hidden="true">⌘↵</Kbd>
		</Button>
	</Dialog.Footer>
</form>
