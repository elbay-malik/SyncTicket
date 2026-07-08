<script lang="ts">
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
</script>

<svelte:head>
	<title>Issues · SyncTicket</title>
</svelte:head>

<div class="mx-auto w-full max-w-5xl">
	<div class="flex items-center justify-between">
		<h1 class="text-lg font-semibold tracking-tight">Issues</h1>
		<Tooltip.Provider>
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<span {...props}>
							<Button disabled>
								<PlusIcon />
								New issue
							</Button>
						</span>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>Coming in Phase 4</Tooltip.Content>
			</Tooltip.Root>
		</Tooltip.Provider>
	</div>

	<Separator class="my-4" />

	<div
		class="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-12 text-center"
	>
		<CircleDotIcon class="text-muted-foreground size-8" />
		<p class="text-base font-medium">No issues yet</p>
		<p class="text-muted-foreground max-w-sm text-sm">
			Issues live entirely in your browser — local-first storage arrives in Phase 2.
		</p>
	</div>
</div>
