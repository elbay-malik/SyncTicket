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
			items: shortcuts.listed.filter((shortcut) => shortcut.group === group)
		})).filter((section) => section.items.length > 0)
	);

	/**
	 * Keys the focused widget owns natively rather than the registry (see issue-list).
	 *
	 * Display-only on purpose. These are NOT registered with `hidden: false`, or with any flag:
	 * the registry dispatches every entry it holds, so registering ← → would add a second
	 * global handler racing the list's own `onKeydown` — which knows the row, clamps at its
	 * ends and leaves the key alone when nothing moved, none of which a global chord can.
	 * The registry's `hidden` hides a real shortcut from display; there is no inverse "shown
	 * but not dispatched" entry, and this list is that, kept beside the one view that needs it.
	 */
	const listKeys = [
		{ hint: '↑ ↓', label: 'Move the cursor inside the list' },
		// The within-row walk (issue-list's moveWithinRow). Undocumented until a critique found
		// a keyboard user who never learnt the pickers were reachable without Tab.
		{ hint: '← →', label: "Move across a row's status and priority" },
		{ hint: '↵', label: 'Open the focused issue' },
		{ hint: 'Esc', label: 'Leave the quick-add field' }
	];
</script>

<!-- Every chip here is `showOnTouch`: Kbd hides inline hints on touch-only devices, but this
     sheet is ABOUT the keys, and with the chips gone it would be a list of labels pointing at
     nothing. Someone who opens it on a phone is reading up before sitting at a keyboard. -->
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
							<Kbd showOnTouch>{shortcut.hint}</Kbd>
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
						<Kbd showOnTouch>{item.hint}</Kbd>
					</div>
				{/each}
			</section>

			<section class="flex flex-col gap-2">
				<h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">Board</h3>
				<div class="flex items-center justify-between gap-4 text-sm">
					<span>Pick up or drop a card</span>
					<Kbd showOnTouch>Space</Kbd>
				</div>
				<div class="flex items-center justify-between gap-4 text-sm">
					<span>Move within a column</span>
					<Kbd showOnTouch>↑ ↓</Kbd>
				</div>
				<div class="flex items-center justify-between gap-4 text-sm">
					<span>Move to another column</span>
					<Kbd showOnTouch>Tab</Kbd>
				</div>
			</section>
		</div>
	</Sheet.Content>
</Sheet.Root>
