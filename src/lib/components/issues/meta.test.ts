/*
	Two non-text contrast obligations live here, both WCAG 1.4.11 (3:1), neither of them
	eyeballable and neither of them answerable from a hex value remembered out of Tailwind v3.
	So this test does the arithmetic: it reads the oklch values out of the *installed*
	`tailwindcss/theme.css` and the theme tokens out of `layout.css`, converts oklch -> linear
	sRGB -> WCAG relative luminance, and measures.

	1. The status and priority badges. They render icon-only in list rows and board cards
	   (`showLabel={false}`), which makes the icon the information rather than decoration.
	   Surfaces: `--background` (page), `--card` (board card), `--popover` (pickers, palette,
	   dialogs, sheets) and `--muted` (a row on hover or when it holds the cursor). Contrast is
	   monotonic in lightness and these badge colours are darker than every light surface and
	   lighter than every dark one, so those four bracket the real worst case in each theme.

	2. Every focus ring. `--ring` is not the only one: the sidebar primitives draw
	   `ring-sidebar-ring`, and `<AppSidebar />` is mounted by the root layout on every route,
	   so `--sidebar-ring` colours the focus indicator on the app's primary navigation. That was
	   nearly missed once: `--sidebar-ring` was changed on the guess that the sidebar primitives
	   were vendored-but-unused, and nothing measured it either way. So the ring half of this file
	   does not take a hand-written list of tokens on trust. It scans every `.svelte` file for the
	   colours focus rings are actually drawn in, and fails if one is not in the matrix below.

	Reading the stylesheets and the components rather than hard-coding numbers is the point:
	bumping Tailwind, nudging `--muted`, or reaching for a new ring colour in a component moves
	the ratios, and that fails here instead of shipping.
*/

import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PRIORITY_UI, STATUS_UI } from './meta.js';

/** WCAG 2.2 SC 1.4.11 Non-text Contrast. */
const MIN_RATIO = 3;

type Oklch = readonly [l: number, c: number, h: number];
type Srgb = readonly [r: number, g: number, b: number];
type Theme = 'light' | 'dark';

// --- oklch -> sRGB -> WCAG ------------------------------------------------

/** Rejects alpha forms (`oklch(1 0 0 / 10%)`) outright: they are never a surface here. */
function parseOklch(value: string): Oklch {
	const match = /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?\s*\)$/.exec(value.trim());
	if (!match) throw new Error(`not an opaque oklch colour: ${value}`);
	const [, l, c, h] = match as unknown as [string, string, string, string];
	const number = (part: string) =>
		part.endsWith('%') ? Number(part.slice(0, -1)) / 100 : Number(part);
	return [number(l), number(c), Number(h)];
}

/** Oklab -> linear sRGB (Björn Ottosson's matrices). Components may fall outside [0, 1]. */
function toLinearSrgb([lightness, chroma, hue]: Oklch): [number, number, number] {
	const radians = (hue * Math.PI) / 180;
	const a = chroma * Math.cos(radians);
	const b = chroma * Math.sin(radians);
	const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
	];
}

/**
 * Tailwind's palette is wider than sRGB, so several of these swatches are out of gamut. Clamping
 * after encoding is what a browser on an sRGB display effectively shows, and what every contrast
 * checker computes from — a perceptual gamut map would move the numbers by a hair, never across
 * the 3:1 line at the margins this palette keeps.
 */
function toSrgb(colour: Oklch): Srgb {
	return toLinearSrgb(colour).map((channel) => {
		const encoded = channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
		return Math.min(1, Math.max(0, encoded));
	}) as [number, number, number];
}

function relativeLuminance(srgb: Srgb): number {
	const [r, g, b] = srgb.map((channel) =>
		channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
	) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

function contrast(a: Oklch, b: Oklch): number {
	return ratio(relativeLuminance(toSrgb(a)), relativeLuminance(toSrgb(b)));
}

/**
 * The one alpha case that matters: Tailwind's `/50` suffix is `color-mix(in oklab, <colour> 50%,
 * transparent)`, i.e. the token at half alpha, which the browser then composites onto the backdrop
 * in gamma-encoded sRGB. shadcn ships `outline-ring/50` and `ring-ring/50`; `layout.css` takes the
 * base-layer outline solid instead, and the ratios that comment quotes are these.
 */
function blendedContrast(colour: Oklch, backdrop: Oklch, alpha: number): number {
	const [fg, bg] = [toSrgb(colour), toSrgb(backdrop)];
	const mixed = bg.map((channel, i) => alpha * (fg[i] ?? 0) + (1 - alpha) * channel) as [
		number,
		number,
		number
	];
	return ratio(relativeLuminance(mixed), relativeLuminance(bg));
}

// --- the stylesheets these utilities actually resolve against -------------

function readDeclarations(body: string): Map<string, string> {
	const declarations = new Map<string, string>();
	for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
		if (name && value) declarations.set(name, value.trim());
	}
	return declarations;
}

/** Comments go first — several of them quote token names and ratios. */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function readBlock(css: string, selector: string): Map<string, string> {
	const open = css.indexOf(`${selector} {`);
	if (open === -1) throw new Error(`no ${selector} block found`);
	const close = css.indexOf('\n}', open);
	return readDeclarations(css.slice(open, close));
}

const require_ = createRequire(import.meta.url);
// The whole file is one `@theme default` block plus keyframes, and keyframes declare no custom
// properties — so there is nothing to scope to here.
const PALETTE = readDeclarations(
	stripComments(readFileSync(require_.resolve('tailwindcss/theme.css'), 'utf8'))
);
const SRC = fileURLToPath(new URL('../../../', import.meta.url));
const LAYOUT_CSS = stripComments(readFileSync(join(SRC, 'routes/layout.css'), 'utf8'));
const ROOT = readBlock(LAYOUT_CSS, ':root');
const DARK = readBlock(LAYOUT_CSS, '.dark');

/** `.dark` overrides a subset of `:root`; anything it omits still comes from `:root`. */
function token(name: string, theme: Theme): Oklch {
	const value = (theme === 'dark' ? DARK.get(name) : undefined) ?? ROOT.get(name);
	if (!value) throw new Error(`layout.css defines no ${name}`);
	return parseOklch(value);
}

const BADGE_SURFACES = ['--background', '--card', '--popover', '--muted'] as const;

/**
 * Resolve one Tailwind colour utility. A semantic name falls through to `layout.css`, so
 * `text-muted-foreground` is measured as the token it renders as rather than skipped.
 */
function utilityColour(utility: string, theme: Theme): Oklch {
	const name = utility.replace(/^(?:text|bg)-/, '');
	const swatch = PALETTE.get(`--color-${name}`);
	return swatch ? parseOklch(swatch) : token(`--${name}`, theme);
}

/**
 * Pick the utility that wins in `theme`. The `dark` variant is `&:is(.dark *)` — one class more
 * specific than the bare utility — so it wins on specificity, not source order.
 */
function resolve(classes: string, theme: Theme): Oklch {
	let base: string | undefined;
	let dark: string | undefined;
	for (const cls of classes.split(/\s+/).filter(Boolean)) {
		if (cls.startsWith('dark:')) dark = cls.slice('dark:'.length);
		else base = cls;
	}
	const winner = theme === 'dark' ? (dark ?? base) : base;
	if (!winner) throw new Error(`no colour utility in "${classes}"`);
	return utilityColour(winner, theme);
}

const CASES = [
	...Object.entries(STATUS_UI).flatMap(([status, ui]) => [
		{ label: `status ${status} icon`, classes: ui.class },
		{ label: `status ${status} dot`, classes: ui.dot }
	]),
	...Object.entries(PRIORITY_UI).map(([priority, ui]) => ({
		label: `priority ${priority} icon`,
		classes: ui.class
	}))
];

// --- which colours the app actually draws focus rings in ------------------

const COMPONENTS = new Map(
	readdirSync(SRC, { recursive: true, encoding: 'utf8' })
		.filter((path) => path.endsWith('.svelte'))
		// Normalise for the assertions below; readdir yields the platform separator.
		.map((path) => [path.split(/[\\/]/).join('/'), readFileSync(join(SRC, path), 'utf8')] as const)
);

/**
 * A focus ring is two utilities, and shadcn splits them: the sidebar primitives put the *colour*
 * in the unprefixed base (`ring-sidebar-ring`) and gate only the *width* on focus
 * (`focus-visible:ring-2`). Keying off the prefixed colour alone is exactly how `--sidebar-ring`
 * escaped the first time. So: a file that gates a ring width on focus draws focus rings, and every
 * solid ring colour in it is one of the colours it draws them in.
 *
 * Alpha forms are left out on purpose — `ring-ring/50` in the inputs is a halo around the solid
 * `focus-visible:border-ring` that carries the indicator, so it is the border, not the halo, that
 * owes 3:1. A `/50` ring can never reach it (see `blendedContrast` and its test).
 */
const FOCUS_RING_WIDTH = /\b(?:focus|focus-visible):ring-(?:\d+|\[[^\]]*\])/;
const RING_COLOUR = /(?<![\w-])ring-([a-z][a-z\d-]*)(\/\d+)?/g;

function focusRingTokens(source: string): string[] {
	if (!FOCUS_RING_WIDTH.test(source)) return [];
	const tokens: string[] = [];
	for (const [, name, alpha] of source.matchAll(RING_COLOUR)) {
		// `ring-inset` and `ring-offset-2` are geometry, not colour.
		if (!name || alpha || name === 'inset' || name.startsWith('offset')) continue;
		tokens.push(`--${name}`);
	}
	return tokens;
}

/** token -> the files that draw a focus ring in it, relative to `src/`. */
const RING_USAGE = new Map<string, string[]>();
for (const [path, source] of COMPONENTS) {
	for (const name of focusRingTokens(source)) {
		const files = RING_USAGE.get(name) ?? [];
		if (!files.includes(path)) files.push(path);
		RING_USAGE.set(name, files);
	}
}

/**
 * Every colour a focus ring is drawn in, against every surface that ring has to separate from.
 *
 * A Tailwind ring is a non-inset box-shadow, so it is painted *outside* the border box: the colour
 * it has to be found against is the surface behind the control. Its inner edge also meets the
 * control's own fill, and where that fill is a near-neutral tint a ring could vanish into it is
 * measured too (`--muted`, `--secondary`, `--accent`, `--sidebar-accent`).
 *
 * The saturated fills — `--primary`, and the tint under the destructive button's own ring — are
 * left out, and that is a scope decision rather than an impossibility: a ring at oklch 0.51–0.64
 * light or 0.55–0.61 dark would clear 3:1 on `--primary` too, but only by spending most of its
 * margin where the indicator is actually looked for (0.64 is 3.36:1 on `--background`, against
 * 7.44:1 at today's 0.45, which measures 2.41:1 on light `--primary`). 1.4.11 asks for contrast
 * with the adjacent background, and that is what this matrix is. `--destructive` is in it because
 * the destructive button draws its *ring* in that token (ui/button), not because it is a fill.
 *
 * Several of these tokens hold the same value today (`--muted`, `--secondary`, `--accent` and
 * `--sidebar-accent` are all oklch(0.97) light / oklch(0.269) dark). Naming each one is what keeps
 * the measurement true when one of them moves on its own.
 */
const RING_SURFACES: Record<string, readonly string[]> = {
	// `focus-visible:ring-ring` on ui/button, issue-row, board-column and presence-bar, plus the
	// root layout's skip link (`focus:ring-ring`). `--sidebar` is in the list because that link is
	// `fixed` in the top-left corner, which is over the sidebar whenever the sidebar is open.
	'--ring': [
		'--background',
		'--card',
		'--popover',
		'--muted',
		'--secondary',
		'--accent',
		'--sidebar'
	],
	// `ring-sidebar-ring` + `focus-visible:ring-2` on every sidebar control, which in this app
	// means the three Sidebar.MenuButtons of the primary nav. They sit on `--sidebar`, and an
	// active or hovered one fills with `--sidebar-accent`, which the ring then abuts.
	'--sidebar-ring': ['--sidebar', '--sidebar-accent'],
	// The destructive button's own ring (ui/button). It appears in the detail sheet and in alert
	// dialogs, both `--popover`, and nothing stops it from being used on the page or in a card.
	'--destructive': ['--background', '--card', '--popover', '--muted']
};

const RING_CASES = Object.entries(RING_SURFACES).flatMap(([ring, surfaces]) =>
	surfaces.map((surface) => ({ ring, surface }))
);

describe('colour maths', () => {
	it('reproduces known WCAG ratios', () => {
		expect(contrast([0, 0, 0], [1, 0, 0])).toBeCloseTo(21, 6);
		expect(contrast([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
		// amber-500 on white: the measurement that started all of this.
		expect(contrast(utilityColour('text-amber-500', 'light'), [1, 0, 0])).toBeCloseTo(2.145, 3);
	});

	it('reads both stylesheets', () => {
		expect(PALETTE.get('--color-amber-500')).toBe('oklch(76.9% 0.188 70.08)');
		expect(ROOT.get('--background')).toBe('oklch(1 0 0)');
		expect(DARK.get('--muted')).toBe('oklch(0.269 0 0)');
	});
});

describe.each(['light', 'dark'] as const)('%s theme', (theme) => {
	it.each(CASES)('$label clears 3:1 on every surface', ({ classes }) => {
		const colour = resolve(classes, theme);
		for (const surface of BADGE_SURFACES) {
			expect(
				contrast(colour, token(surface, theme)),
				`${classes} on ${surface} (${theme})`
			).toBeGreaterThanOrEqual(MIN_RATIO);
		}
	});

	it.each(RING_CASES)('$ring clears 3:1 on $surface', ({ ring, surface }) => {
		expect(
			contrast(token(ring, theme), token(surface, theme)),
			`${ring} on ${surface} (${theme})`
		).toBeGreaterThanOrEqual(MIN_RATIO);
	});
});

describe('focus rings', () => {
	it('measures every colour the app draws one in', () => {
		expect([...RING_USAGE.keys()].sort()).toEqual(Object.keys(RING_SURFACES).sort());
	});

	// The chain that makes `--sidebar-ring` a live indicator rather than dormant vendored code,
	// asserted end to end so nobody writes it off as unused again: the root layout mounts the
	// sidebar, the sidebar renders MenuButtons, and that primitive rings in `--sidebar-ring`.
	it('is the primary navigation, not dormant vendored code', () => {
		expect(COMPONENTS.get('routes/+layout.svelte')).toMatch(/<AppSidebar\s*\/>/);
		expect(COMPONENTS.get('lib/components/shell/app-sidebar.svelte')).toMatch(
			/<Sidebar\.MenuButton/
		);
		expect(RING_USAGE.get('--sidebar-ring')).toContain(
			'lib/components/ui/sidebar/sidebar-menu-button.svelte'
		);
	});

	// Pins the numbers `layout.css` quotes for taking the base-layer outline solid. A `/50` blend
	// is under 3:1 at any lightness a focus ring would plausibly use: on white it takes a ring
	// darker than about oklch(0.285) — near black — before the blend itself reaches 3:1.
	it('cannot be drawn at /50 and still clear 3:1', () => {
		const blend = (surface: string, theme: Theme) =>
			blendedContrast(token('--ring', theme), token(surface, theme), 0.5);
		expect(blend('--background', 'light')).toBeCloseTo(2.32, 2);
		expect(blend('--muted', 'light')).toBeCloseTo(2.26, 2);
		for (const theme of ['light', 'dark'] as const) {
			for (const surface of RING_SURFACES['--ring'] ?? []) {
				expect(blend(surface, theme), `--ring/50 on ${surface} (${theme})`).toBeLessThan(MIN_RATIO);
			}
		}
	});
});
