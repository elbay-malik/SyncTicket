<script lang="ts">
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SunIcon from '@lucide/svelte/icons/sun';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { resetMode, setMode } from 'mode-watcher';
	import * as Command from '$lib/components/ui/command/index.js';
	import { issueUi } from '$lib/state/ui.svelte.js';

	let open = $state(false);

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			open = !open;
		}
	}

	function run(action: () => void) {
		open = false;
		action();
	}
</script>

<svelte:document onkeydown={handleKeydown} />

<Command.Dialog bind:open>
	<Command.Input placeholder="Type a command or search…" />
	<Command.List>
		<Command.Empty>No results found.</Command.Empty>
		<Command.Group heading="Issues">
			<Command.Item
				onSelect={() =>
					run(async () => {
						// The dialog is mounted in the issues layout, so make sure we're there first.
						await goto(resolve('/issues'));
						issueUi.createOpen = true;
					})}
			>
				<PlusIcon />
				New issue
				<Command.Shortcut>C</Command.Shortcut>
			</Command.Item>
		</Command.Group>
		<Command.Group heading="Navigation">
			<Command.Item onSelect={() => run(() => goto(resolve('/issues')))}>
				<CircleDotIcon />
				Go to Issues
			</Command.Item>
		</Command.Group>
		<Command.Group heading="Theme">
			<Command.Item onSelect={() => run(() => setMode('light'))}>
				<SunIcon />
				Light
			</Command.Item>
			<Command.Item onSelect={() => run(() => setMode('dark'))}>
				<MoonIcon />
				Dark
			</Command.Item>
			<Command.Item onSelect={() => run(() => resetMode())}>
				<MonitorIcon />
				System
			</Command.Item>
		</Command.Group>
	</Command.List>
</Command.Dialog>
