<script lang="ts">
	// The palette lists the shortcut registry rather than a second, hand-kept copy of it, so
	// a command and its key can never disagree. Theme actions have no chord and stay local.

	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SunIcon from '@lucide/svelte/icons/sun';
	import { tick } from 'svelte';
	import { resetMode, setMode } from 'mode-watcher';
	import { shortcuts } from '$lib/keyboard/registry.svelte.js';
	import { issueUi } from '$lib/state/ui.svelte.js';
	import * as Command from '$lib/components/ui/command/index.js';

	const GROUPS = ['Issues', 'Navigation'] as const;

	const byGroup = $derived(
		GROUPS.map((group) => ({
			group,
			// The palette itself is one of the shortcuts; offering "open the command palette"
			// inside the open command palette would be silly.
			items: shortcuts.listed.filter(
				(shortcut) => shortcut.group === group && shortcut.id !== 'palette'
			)
		})).filter((section) => section.items.length > 0)
	);

	async function run(action: () => void) {
		issueUi.paletteOpen = false;
		// Let this dialog finish closing first: opening another in the same tick lets the
		// palette's focus restore fire inside the new dialog's focus scope.
		await tick();
		action();
	}
</script>

<!--
	vimBindings must be off: bits-ui's Command treats Ctrl+K as "previous item" and calls
	preventDefault, which would swallow the palette's own toggle on Linux and Windows — and
	so on CI, where the e2e runs.
-->
<Command.Dialog bind:open={issueUi.paletteOpen} vimBindings={false}>
	<Command.Input placeholder="Type a command or search…" />
	<Command.List>
		<!-- The viewport is what gives Command.Input its aria-controls and
		     aria-activedescendant; without it the highlighted item is never announced. -->
		<Command.Viewport>
			<Command.Empty>No results found.</Command.Empty>
			{#each byGroup as section (section.group)}
				<Command.Group heading={section.group}>
					{#each section.items as shortcut (shortcut.id)}
						<!-- An explicit value keeps the chord glyph out of the filter key, which
						     bits-ui otherwise derives from the item's text content. -->
						<Command.Item value={shortcut.label} onSelect={() => run(shortcut.run)}>
							{shortcut.label}
							<Command.Shortcut aria-hidden="true">{shortcut.hint}</Command.Shortcut>
						</Command.Item>
					{/each}
				</Command.Group>
			{/each}
			<Command.Group heading="Theme">
				<Command.Item value="Light theme" onSelect={() => run(() => setMode('light'))}>
					<SunIcon />
					Light
				</Command.Item>
				<Command.Item value="Dark theme" onSelect={() => run(() => setMode('dark'))}>
					<MoonIcon />
					Dark
				</Command.Item>
				<Command.Item value="System theme" onSelect={() => run(() => resetMode())}>
					<MonitorIcon />
					System
				</Command.Item>
			</Command.Group>
		</Command.Viewport>
	</Command.List>
</Command.Dialog>
