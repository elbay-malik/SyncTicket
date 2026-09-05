// Presentation metadata for the issue enums: icon + colour per status/priority. This is
// deliberately outside `model/` (which must stay free of runtime deps) — the model owns
// labels and ranks, the UI owns how they look.

import CircleIcon from '@lucide/svelte/icons/circle';
import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
import CircleDashedIcon from '@lucide/svelte/icons/circle-dashed';
import CircleDotDashedIcon from '@lucide/svelte/icons/circle-dot-dashed';
import CircleXIcon from '@lucide/svelte/icons/circle-x';
import MinusIcon from '@lucide/svelte/icons/minus';
import SignalHighIcon from '@lucide/svelte/icons/signal-high';
import SignalLowIcon from '@lucide/svelte/icons/signal-low';
import SignalMediumIcon from '@lucide/svelte/icons/signal-medium';
import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
import type { IssuePriority, IssueStatus } from '$lib/model/issue.js';

/** Every Lucide icon shares this component type. */
export type IconComponent = typeof CircleIcon;

export interface EnumUi {
	icon: IconComponent;
	/** Text/icon colour utility. */
	class: string;
}

export const STATUS_UI: Record<IssueStatus, EnumUi & { dot: string }> = {
	backlog: { icon: CircleDashedIcon, class: 'text-zinc-500', dot: 'bg-zinc-400' },
	todo: { icon: CircleIcon, class: 'text-blue-500', dot: 'bg-blue-500' },
	in_progress: { icon: CircleDotDashedIcon, class: 'text-amber-500', dot: 'bg-amber-500' },
	done: { icon: CircleCheckIcon, class: 'text-emerald-500', dot: 'bg-emerald-500' },
	canceled: { icon: CircleXIcon, class: 'text-red-500', dot: 'bg-red-500' }
};

export const PRIORITY_UI: Record<IssuePriority, EnumUi> = {
	none: { icon: MinusIcon, class: 'text-muted-foreground' },
	low: { icon: SignalLowIcon, class: 'text-muted-foreground' },
	medium: { icon: SignalMediumIcon, class: 'text-foreground' },
	high: { icon: SignalHighIcon, class: 'text-foreground' },
	urgent: { icon: TriangleAlertIcon, class: 'text-orange-500' }
};
