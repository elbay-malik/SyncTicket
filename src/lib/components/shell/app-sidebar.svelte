<script lang="ts">
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SquareKanbanIcon from '@lucide/svelte/icons/square-kanban';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Kbd } from '$lib/components/ui/kbd/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';

	const planned = [
		{ label: 'Board', phase: 'Phase 5', icon: SquareKanbanIcon },
		{ label: 'Search', phase: 'Phase 8', icon: SearchIcon }
	];
</script>

<Sidebar.Root>
	<Sidebar.Header>
		<div class="flex items-center gap-2 px-2 py-1.5">
			<ZapIcon class="size-4" />
			<span class="text-sm font-semibold tracking-tight">SyncTicket</span>
		</div>
	</Sidebar.Header>
	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupLabel>Workspace</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton isActive={page.url.pathname.startsWith('/issues')}>
							{#snippet child({ props })}
								<a href={resolve('/issues')} {...props}>
									<CircleDotIcon />
									<span>Issues</span>
								</a>
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
					{#each planned as item (item.label)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton
								aria-disabled="true"
								class="pointer-events-none"
								title="{item.label} arrives in {item.phase}"
							>
								<item.icon class="opacity-50" />
								<span class="opacity-50">{item.label}</span>
								<Badge variant="outline" class="ml-auto text-[10px]">{item.phase}</Badge>
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>
	<Sidebar.Footer>
		<div class="text-muted-foreground flex items-center justify-between px-2 py-1 text-xs">
			<span>Command menu</span>
			<Kbd>⌘K</Kbd>
		</div>
	</Sidebar.Footer>
</Sidebar.Root>
