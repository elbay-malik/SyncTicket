<script lang="ts">
	// A view over the registry, so it can never drift from what actually works.
	import { shortcuts, type ShortcutGroup } from '$lib/keyboard/registry.svelte.js';
	import { Kbd } from '$lib/components/ui/kbd/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	const GROUPS: ShortcutGroup[] = ['Issues', 'Navigation', 'View'];

	const byGroup = $derived(
		GROUPS.map((group) => ({
			group,
			items: shortcuts.all.filter((shortcut) => shortcut.group === group)
		})).filter((section) => section.items.length > 0)
	);

	/** Keys the focused widget owns natively rather than the registry (see issue-list). */
	const listKeys = [
		{ hint: '↑ ↓', label: 'Move the cursor inside the list' },
		{ hint: '↵', label: 'Open the focused issue' },
		{ hint: 'Esc', label: 'Leave the quick-add field' }
	];
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="right" class="w-full data-[side=right]:sm:max-w-sm">
		<Sheet.Header>
			<Sheet.Title>Keyboard shortcuts</Sheet.Title>
			<Sheet.Description>Everything here works without a mouse.</Sheet.Description>
		</Sheet.Header>

		<div class="flex flex-col gap-6 overflow-y-auto px-4 pb-4">
			{#each byGroup as section (section.group)}
				<section class="flex flex-col gap-2">
					<h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
						{section.group}
					</h3>
					{#each section.items as shortcut (shortcut.id)}
						<div class="flex items-center justify-between gap-4 text-sm">
							<span>{shortcut.label}</span>
							<Kbd>{shortcut.hint}</Kbd>
						</div>
					{/each}
				</section>
			{/each}

			<section class="flex flex-col gap-2">
				<h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
					Issue list
				</h3>
				{#each listKeys as item (item.hint)}
					<div class="flex items-center justify-between gap-4 text-sm">
						<span>{item.label}</span>
						<Kbd>{item.hint}</Kbd>
					</div>
				{/each}
			</section>

			<section class="flex flex-col gap-2">
				<h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">Board</h3>
				<div class="flex items-center justify-between gap-4 text-sm">
					<span>Pick up or drop a card</span>
					<Kbd>Space</Kbd>
				</div>
				<div class="flex items-center justify-between gap-4 text-sm">
					<span>Move within a column</span>
					<Kbd>↑ ↓</Kbd>
				</div>
				<div class="flex items-center justify-between gap-4 text-sm">
					<span>Move to another column</span>
					<Kbd>Tab</Kbd>
				</div>
			</section>
		</div>
	</Sheet.Content>
</Sheet.Root>
