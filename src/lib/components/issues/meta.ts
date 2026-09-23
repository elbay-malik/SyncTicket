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

/*
	These colours are load-bearing, not decorative: list rows and board cards render the badges
	with `showLabel={false}`, so the icon *is* the information and WCAG 1.4.11 wants 3:1 against
	every surface it can sit on — `--background`/`--card`/`--popover`, and the `--muted` a row
	takes on when hovered or selected. Tailwind's -500 steps miss that in light mode by a long
	way (amber-500 is 1.97:1 on `--muted`, emerald-500 2.26:1), while in dark mode they are
	already comfortable, so each entry is a light step with a `dark:` -500 override rather than
	one value for both themes.

	The light steps are not picked per hue by eye: each is the step whose measured ratio on
	`--muted` lands closest to the others, which puts all six between 4.37:1 (red-600) and 4.92:1
	(emerald-700) and their oklch lightness between 0.51 and 0.58, so they read as one family.
	`meta.test.ts` recomputes every ratio here from the installed `tailwindcss/theme.css` and from
	`layout.css`, so changing a step — or a theme token — that drops one below 3:1 fails the suite
	instead of shipping.

	The dots follow the same steps as the icons. They are redundant next to their label in the
	filter menu and so exempt from 1.4.11, but a 2px amber-500 dot on white is 2.1:1 either way.
*/
export const STATUS_UI: Record<IssueStatus, EnumUi & { dot: string }> = {
	backlog: {
		icon: CircleDashedIcon,
		class: 'text-zinc-500 dark:text-zinc-400',
		dot: 'bg-zinc-500 dark:bg-zinc-400'
	},
	todo: {
		icon: CircleIcon,
		class: 'text-blue-600 dark:text-blue-500',
		dot: 'bg-blue-600 dark:bg-blue-500'
	},
	in_progress: {
		icon: CircleDotDashedIcon,
		class: 'text-amber-700 dark:text-amber-500',
		dot: 'bg-amber-700 dark:bg-amber-500'
	},
	done: {
		icon: CircleCheckIcon,
		class: 'text-emerald-700 dark:text-emerald-500',
		dot: 'bg-emerald-700 dark:bg-emerald-500'
	},
	canceled: {
		icon: CircleXIcon,
		class: 'text-red-600 dark:text-red-500',
		dot: 'bg-red-600 dark:bg-red-500'
	}
};

export const PRIORITY_UI: Record<IssuePriority, EnumUi> = {
	none: { icon: MinusIcon, class: 'text-muted-foreground' },
	low: { icon: SignalLowIcon, class: 'text-muted-foreground' },
	medium: { icon: SignalMediumIcon, class: 'text-foreground' },
	high: { icon: SignalHighIcon, class: 'text-foreground' },
	urgent: { icon: TriangleAlertIcon, class: 'text-orange-700 dark:text-orange-500' }
};
