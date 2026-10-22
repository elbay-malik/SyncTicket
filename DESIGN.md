---
name: SyncTicket
description: An achromatic, keyboard-first instrument panel for a live collaborative document.
colors:
  background: 'oklch(1 0 0)'
  foreground: 'oklch(0.145 0 0)'
  card: 'oklch(1 0 0)'
  popover: 'oklch(1 0 0)'
  primary: 'oklch(0.205 0 0)'
  primary-foreground: 'oklch(0.985 0 0)'
  secondary: 'oklch(0.97 0 0)'
  muted: 'oklch(0.97 0 0)'
  muted-foreground: 'oklch(0.556 0 0)'
  accent: 'oklch(0.97 0 0)'
  border: 'oklch(0.922 0 0)'
  input: 'oklch(0.922 0 0)'
  ring: 'oklch(0.45 0 0)'
  sidebar: 'oklch(0.985 0 0)'
  sidebar-accent: 'oklch(0.97 0 0)'
  sidebar-ring: 'oklch(0.45 0 0)'
  destructive: 'oklch(0.577 0.245 27.325)'
  status-backlog: 'oklch(55.2% 0.016 285.938)'
  status-todo: 'oklch(54.6% 0.245 262.881)'
  status-in-progress: 'oklch(55.5% 0.163 48.998)'
  status-done: 'oklch(50.8% 0.118 165.612)'
  status-canceled: 'oklch(57.7% 0.245 27.325)'
  priority-urgent: 'oklch(55.3% 0.195 38.402)'
typography:
  title:
    fontFamily: "'Geist Variable', sans-serif"
    fontSize: '1.125rem'
    fontWeight: 600
    lineHeight: '1.75rem'
    letterSpacing: 'normal'
  body:
    fontFamily: "'Geist Variable', sans-serif"
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: '1.25rem'
    letterSpacing: 'normal'
  label:
    fontFamily: "'Geist Variable', sans-serif"
    fontSize: '0.875rem'
    fontWeight: 500
    lineHeight: '1.25rem'
    letterSpacing: 'normal'
  caption:
    fontFamily: "'Geist Variable', sans-serif"
    fontSize: '0.75rem'
    fontWeight: 400
    lineHeight: '1rem'
    letterSpacing: 'normal'
rounded:
  sm: '6px'
  md: '8px'
  lg: '10px'
  xl: '14px'
  2xl: '18px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '10px'
  lg: '12px'
components:
  button-default:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.primary-foreground}'
    rounded: '{rounded.lg}'
    padding: '0 10px'
    height: '32px'
    typography: '{typography.label}'
  button-outline:
    backgroundColor: '{colors.background}'
    textColor: '{colors.foreground}'
    rounded: '{rounded.lg}'
    padding: '0 10px'
    height: '32px'
  button-ghost:
    textColor: '{colors.foreground}'
    rounded: '{rounded.lg}'
    padding: '0 10px'
    height: '32px'
  button-destructive:
    textColor: '{colors.destructive}'
    rounded: '{rounded.lg}'
    padding: '0 10px'
    height: '32px'
  button-sm:
    rounded: '{rounded.md}'
    padding: '0 10px'
    height: '28px'
  input-default:
    backgroundColor: '{colors.background}'
    textColor: '{colors.foreground}'
    rounded: '{rounded.md}'
    padding: '0 12px'
    height: '36px'
  board-column:
    backgroundColor: '{colors.muted}'
    rounded: '{rounded.xl}'
    padding: '12px'
    width: '288px'
  board-card:
    backgroundColor: '{colors.card}'
    rounded: '{rounded.lg}'
    padding: '10px'
  popover-content:
    backgroundColor: '{colors.popover}'
    textColor: '{colors.foreground}'
    rounded: '{rounded.lg}'
    padding: '12px'
    width: '288px'
  brand-mark:
    textColor: '{colors.foreground}'
    size: '20px'
  brand-mark-sm:
    textColor: '{colors.foreground}'
    size: '16px'
---

# Design System: SyncTicket

## Overview

**Creative North Star: "The Instrument Panel"**

SyncTicket is a reading surface for a live system. The palette is achromatic by construction —
every neutral in both themes is `oklch(L 0 0)`, zero chroma, no exceptions — so that the handful
of coloured signals in the interface are the only coloured things in it. A blue dot means Todo. An
amber ring means In Progress. A triangle in orange means Urgent. Nothing else in the product is
allowed to compete with those readings, and that is what makes them legible at a glance across a
list of four thousand rows.

The character is **refined and restrained**: precision in place of expression. Hairline borders
rather than shadows, a four-step type scale that tops out at 18px, one weight doing almost all the
work, and focus rings whose contrast was measured rather than assumed. Density is operator density
— 32px default buttons, 28px and 24px variants, 10px of padding inside a board card — because the
person reading this surface is scanning a system's state, not browsing a page.

What makes the restraint credible is that it is checked. The focus ring was darkened from
shadcn's stock `oklch(0.708)` to `oklch(0.45)` because the stock value measured 2.59:1 against the
background and missed WCAG 1.4.11's 3:1 on every surface the app has; at 0.45 it measures 7.44:1.
Status colours are per-theme (a light step with a `dark:` `-500` override) rather than one shared
step, because the stock `-500` family reaches only 2.15–2.89:1 on white and the badges render
icon-only, which makes the icon the information. `meta.test.ts` recomputes every one of those
ratios from the installed Tailwind source on each run, so none of these numbers is a claim — they
are assertions that fail the suite when broken.

**Key Characteristics:**

- Achromatic by default; hue reserved entirely for state
- Flat in flow, elevated only when genuinely floating
- Four-step type scale, no display tier, `font-medium` as the working weight
- Operator density: 32px controls, 10–12px interior padding
- Focus as a first-class visual element, with measured contrast
- Motion that is brief (100–200ms) and fully removable

## Colors

A pure greyscale system with a small, strictly semantic colour vocabulary layered on top.

### Primary

- **Ink** (`oklch(0.205 0 0)` light / `oklch(0.922 0 0)` dark): the solid-fill action colour, used
  on the one primary button per surface and on sidebar active states. It inverts between themes
  rather than shifting hue, because there is no hue to shift.

### Neutral

- **Paper** (`oklch(1 0 0)` light / `oklch(0.145 0 0)` dark): page and card background. Pure white
  and near-black; the system does not tint its ground.
- **Ink** (`oklch(0.145 0 0)` light / `oklch(0.985 0 0)` dark): body text.
- **Dimmed Ink** (`oklch(0.556 0 0)` light / `oklch(0.708 0 0)` dark): secondary text, timestamps,
  placeholder, and the `none`/`low` priority glyphs — the deliberate "this is present but not the
  point" register.
- **Shelf** (`oklch(0.97 0 0)` light / `oklch(0.269 0 0)` dark): the single tonal fill, serving as
  `muted`, `secondary` and `accent` at once. Hover states, board-column grounds and badge fills all
  come from this one step, which is why surfaces separate without needing shadows.
- **Hairline** (`oklch(0.922 0 0)` light / `oklch(1 0 0 / 10%)` dark): every border in the product.
  In dark mode it becomes a translucent white rather than a lighter grey, so it reads as an edge
  catching light instead of a drawn line.
- **Focus Grey** (`oklch(0.45 0 0)` light / `oklch(0.65 0 0)` dark): the ring. Darker than
  convention on purpose — see Overview.

### Tertiary

The semantic signal set. Each is a light-theme step with a brighter `dark:` override, never one
shared value:

- **Backlog Zinc** (`oklch(55.2% 0.016 285.938)` / dark `zinc-400`): the almost-neutral end of the
  status scale, for work nobody has committed to.
- **Todo Blue** (`oklch(54.6% 0.245 262.881)` / dark `blue-500`): committed, not started.
- **In-Progress Amber** (`oklch(55.5% 0.163 48.998)` / dark `amber-500`): active work.
- **Done Emerald** (`oklch(50.8% 0.118 165.612)` / dark `emerald-500`): complete.
- **Canceled Red** (`oklch(57.7% 0.245 27.325)` / dark `red-500`): abandoned.
- **Urgent Orange** (`oklch(55.3% 0.195 38.402)` / dark `orange-500`): the only priority with a
  colour of its own. `medium` and `high` escalate by weight and glyph instead, so urgency reads as
  a step change rather than a gradient.
- **Destructive Red** (`oklch(0.577 0.245 27.325)` light / `oklch(0.704 0.191 22.216)` dark): used
  as text and as a 10% tint behind it, never as a solid fill. A solid red button would be the
  loudest object in an otherwise grey product, which overstates a delete in a demo workspace.

### Peer Identity

Peer avatars are the one place a colour arrives at runtime, and only a **hue number** does. The
theme supplies lightness and chroma (`--peer-l`, `--peer-c`) and swaps both between modes, so an
arbitrary hue stays legible in either theme and a peer can never inject a colour value — a
peer-supplied colour _string_ interpolated into a style attribute would be a CSS injection.

### Named Rules

**The Colour Means State Rule.** Hue is reserved for issue status, urgent priority, destructive
intent, and peer identity. There is no decorative, brand, or emphasis colour anywhere in the
product, and adding one is a defect rather than a liberty: the status signals are readable at a
glance _because_ nothing else is coloured.

**The Per-Theme Step Rule.** A semantic colour is never one value with a theme-independent
meaning. Every status and priority hue is a light step plus a brighter `dark:` override, because
the badges render icon-only and the icon must clear 3:1 on the surface it actually sits on.
Collapsing a pair back to a single shared step fails `meta.test.ts`.

## Typography

**Body Font:** Geist Variable (with `sans-serif`)
**Display Font:** none — the system has no display tier by design.

**Character:** One variable grotesque at one voice. Geist is close-grained and neutral enough to
disappear behind the data, and the system leans on weight and colour rather than family contrast
to build hierarchy. There is no second typeface and no monospace face; keyboard hints use a `kbd`
component, not a font change.

### Hierarchy

- **Title** (600, 1.125rem/18px, 1.75rem): dialog, sheet and alert titles only. This is the
  largest type in the product. Used twice per screen at most.
- **Subtitle** (500–600, 1rem/16px): the issue editor's title field and route headings. Also the
  size inputs take below `md` so iOS does not zoom on focus.
- **Body** (400, 0.875rem/14px, 1.25rem): the working size and by a wide margin the most common —
  row titles, popover sentences, form values, menu items.
- **Label** (500, 0.875rem/14px): buttons, column headings, nav items, field labels. The same size
  as body, separated only by weight.
- **Caption** (400, 0.75rem/12px): metadata, counts, timestamps, empty-state hints, badge text.

### Named Rules

**The One Weight Rule.** `font-medium` (500) carries the interface; `font-semibold` (600) appears
only on the few titles, and `font-bold` appears nowhere at all. Hierarchy comes from size, weight
and colour in that order — never from a heavier face.

**The Four-Step Rule.** 12 / 14 / 16 / 18px is the entire scale. A new size is a decision about
the whole system, not about one component; an instrument panel with six type sizes stops reading
as one instrument.

## Layout

An application shell, not a page: a persistent sidebar (`Sidebar.Provider`) with a single
`<main id="main-content" tabindex="-1">` beside it, owned by the root layout. The skip link sits
ahead of the sidebar in DOM order, which is the only position from which it actually skips
anything.

Spacing is a tight 4/8/10/12px rhythm. Interior padding is 10px (`p-2.5`) in board cards and
12px (`p-3`) in columns and popovers; gaps between related controls are 4–8px. There is no
generous-spacing tier, because the surface is read densely on purpose.

Two list surfaces, two strategies. The issue list is **virtualized** (virtua) inside a single
scroll container with a `rounded-lg border` frame, and holds 10,000 rows without degrading. Board
columns are **capped rather than virtualized**, each a fixed 288px (`w-72`) wide and horizontally
scrolled as a set — a virtualized drop target and a drag library do not compose.

Responsive behavior is breakpoint-light: `sm:` (23 uses) and `md:` (15) do nearly all the work,
with `lg:` and `xl:` almost unused. The shell collapses the sidebar below `md`, inputs step up to
16px below `md` to prevent iOS zoom, and the board scrolls horizontally on narrow screens rather
than reflowing — a Kanban column that stacks vertically is no longer a Kanban board.

## Elevation & Depth

**Flat in flow. A shadow means the surface is genuinely floating.** In-flow surfaces — rows,
cards, columns, panels, the list frame — separate using a hairline border plus the single tonal
fill, and carry no shadow at all. Elevation is reserved for layers that leave the page: popovers,
dropdown menus, sheets, and the sidebar in its floating variant.

Dialogs are the interesting exception, and the preferred one: `DialogContent` uses
`ring-1 ring-foreground/10` and **no shadow**, defining its edge with a ghost border where a
shadow would conventionally go. It reads as a plate laid on the surface rather than hovering over
it, and it keeps the overlay from muddying in dark mode.

### Shadow Vocabulary

- **Floating layer** (`shadow-md` + `ring-1`): popovers and dropdown menus. The ring does the
  edge definition; the shadow only separates from whatever is beneath.
- **Overlay panel** (`shadow-lg`): sheets and sub-menus, which cover more and need more.
- **Ghost border** (`ring-1 ring-foreground/10`, no shadow): dialogs.

`shadow-none` appears six times in the codebase as a deliberate removal of an inherited default,
which is part of the same doctrine.

### Named Rules

**The Depth Means Floating Rule.** If a surface is in the document flow, it has no shadow. A
shadow on a card, row, panel or column is a defect, not a style choice — border and tonal fill are
how this system separates things.

**Known deviation.** Board cards currently carry `shadow-xs` at rest
(`board-column.svelte:224`), which this rule forbids. It is drift to remove, not a sanctioned
exception: the card should separate from its column by border and fill like every other in-flow
surface.

## Shapes

A soft-rectangular language from a single root radius of `0.625rem` (10px), with the scale derived
by multiplication rather than chosen step by step: `sm` 6px (×0.6), `md` 8px (×0.8), `lg` 10px,
`xl` 14px (×1.4), `2xl` 18px (×1.8). Change `--radius` and the whole system moves together.

In practice: 10px on buttons, rows and board cards; 8px on inputs and the small button sizes
(clamped with `min()` so a small control never looks disproportionately round); 14px on board
columns, so the container reads as softer than the cards inside it. Avatars are the only fully
round objects (`border-radius: 9999px`) — a circle marks a person and nothing else is a circle.

Borders are uniformly 1px and present nearly everywhere. Buttons carry
`border border-transparent` at rest so that gaining a focus border changes no geometry.

## Components

### Buttons

- **Shape:** 10px radius (`rounded-lg`), 1px transparent border at rest
- **Default:** solid Ink fill with Paper text, 32px tall, 10px horizontal padding
- **Hover / Focus:** `focus-visible` draws a 2px ring in Focus Grey _and_ recolours the border;
  pressing nudges the control down one pixel (`active:translate-y-px`), suppressed on menu
  triggers where the surface stays put
- **Outline / Ghost / Secondary:** border plus Paper, nothing plus hover-fill, and Shelf fill
  respectively — all three resolve their hover to the same Shelf step
- **Destructive:** text and icon in Destructive Red over a 10% tint, never a solid fill
- **Sizes:** 24px (`xs`), 28px (`sm`), 32px (default), 36px (`lg`), plus square icon variants at
  each height

### Cards / Containers

- **Corner Style:** 10px (cards), 14px (columns), 10px (list frame)
- **Background:** Paper for cards, Shelf at 40% for board columns — a column reads as a recess
  and the cards as objects resting in it
- **Shadow Strategy:** none; see Elevation & Depth
- **Border:** 1px Hairline, with hover raising it to `foreground/20` on interactive cards
- **Internal Padding:** 10px cards, 12px columns

### Inputs / Fields

- **Style:** 36px tall, 8px radius, 1px Hairline border on Paper; in dark mode a 30% `input` fill
  rather than a border colour change
- **Focus:** border shifts to Focus Grey and a 2px ring joins it — the same treatment as buttons,
  so focus looks identical wherever it lands
- **Error:** `aria-invalid` drives a Destructive border and a 3px tinted ring, keyed off the ARIA
  state rather than a separate class

### Navigation

Sidebar menu buttons at 14px `font-medium`, active state filled with Shelf, each carrying a 2px
`sidebar-ring` on `focus-visible` — this is the app's primary navigation and its ring token was
tuned separately for the two surfaces it sits on (7.13:1 on the sidebar, 6.82:1 on the active
fill). The whole sidebar is one `<nav aria-label="Workspace">`; the app has exactly one.

### Status & Priority Badges

The system's signature component and the reason the palette is grey. A Lucide glyph plus optional
label, where `showLabel={false}` makes **the icon the information** — which is why each hue is a
per-theme pair clearing 3:1 rather than a decorative tint. Rows and board cards use the icon-only
form; pickers and the detail sheet show the label. Priority escalates by glyph and weight
(`minus` → `signal-low` → `signal-medium` → `signal-high` → `triangle-alert`) with colour entering
only at Urgent.

### Peer Avatars

24px circles (18px in the compact stack) of initials, filled from a runtime hue with theme-owned
lightness and chroma, ringed with a 2px `--background` box-shadow so overlapping avatars read as
separate discs. The stack is decoration with a text equivalent beside it: a ring of coloured
initials tells a screen reader nothing, so the readable sentence ("Ada, Bob and 2 others") carries
the information.

### Connection Status

A cloud glyph that opens a 288px popover of two or three plain sentences — where the data lives,
who else has it, and whether the relay can still save it. The third appears only when something
is wrong. When the relay cannot save, the alert glyph **replaces** the connection icon even though
the socket is healthy, because a cloud that says "connected and fine" while data is not surviving
is an active lie.

### Product Mark

The one piece of identity in the product, and the only glyph on screen that is neither Lucide nor
a status. A 24-box drawing in the app's own stroke grammar — 2px stroke, round caps and joins,
`fill="none"` — showing a soft rectangle split into two halves that close on a single filled
centre dot: two copies of a document agreeing on one value. It sits immediately left of the
"SyncTicket" wordmark at 20px in the sidebar and 16px in the app header, and ships again as the
favicon.

- **Geometry:** box inset to 4..20 with a 4.5 corner radius — the card radius, not a circle;
  at 4.5 it reads as this product's panel, and by r=6 it rounds back toward the status family.
  The seams open 2.6 either side of centre. The centre dot is `r=2.7` filled, sized up from the
  Lucide `circle-dot` norm because below that it renders as a smudge at 16px on a 1x display and
  the dot carries the whole meaning.
- **Colour:** none. The mark is `currentColor` throughout, so it inherits `--foreground` and
  needs no dark variant, no token, and no second asset. It obeys the Colour Means State Rule
  rather than claiming a brand exception to it.
- **Favicon:** the same coordinates with exactly two differences — literal ink
  (`#0a0a0a` / `#fafafa`, the sRGB of this theme's foreground pair) behind a
  `prefers-color-scheme` block, because browser chrome is the one surface the product cannot
  theme; and a 2.6 stroke rather than 2, because a 2px stroke in a 24 box renders at 1.33px in a
  tab and goes spindly. Nothing else may diverge: the tab and the sidebar are one mark, not two
  drawings of one idea.
- **Behaviour:** decorative (`aria-hidden`), not interactive, takes no focus. The wordmark beside
  it is plain Geist — 14px semibold in the sidebar, 14px medium in the header — not a letterform.

**The Circle Belongs to Status Rule.** The circle family is spoken for. The app ships six circle
glyphs — `circle`, `circle-dashed`, `circle-dot`, `circle-dot-dashed`, `circle-check`, `circle-x`
— and five of them are the issue statuses, which render icon-only so that the icon is the
information. A ring, or a ring with a centre dot, is therefore not a free shape in this product:
it already reads as In Progress. Identity and chrome draw from the system's other form language,
the soft rectangle of its cards and panels. (The first build of the mark was exactly a
ring-with-dot and sat 70px from a live `circle-dot` in the same sidebar; it was re-derived rather
than shipped.)

**The 16px Adjacency Check.** At 16px on a 1x display the mark narrows toward the
rectangle-family chrome glyphs it now shares a family with — `panel-left`, `square-kanban`. Any
new rectangular icon is rendered beside the mark at 16px before it ships, and changed if the two
are not instantly separable.

## Do's and Don'ts

### Do:

- **Do** reserve hue for state. Status, urgent priority, destructive intent and peer identity are
  the complete list.
- **Do** separate in-flow surfaces with a 1px Hairline border and the Shelf fill, not a shadow.
- **Do** give every semantic colour a per-theme pair (light step + `dark:` override) and let
  `meta.test.ts` recompute its contrast rather than quoting a number.
- **Do** keep type within 12 / 14 / 16 / 18px, and build hierarchy from weight and colour first.
- **Do** make focus visible with the 2px Focus Grey ring _and_ a border change, identically on
  every control.
- **Do** keep transitions at 100–200ms, and give any motion driven through `element.animate()`
  its own reduced-motion opt-out — WAAPI timings ignore the CSS block entirely.
- **Do** design the keyboard path first: every core flow is operable without a mouse, including
  moving cards between board columns.
- **Do** draw identity and chrome in the soft-rectangle form language (the 4.5-in-24 corner, the
  card radius), and leave the circle family to status and to peer avatars.
- **Do** render any new rectangle-family icon beside the product mark at 16px on a 1x display
  before shipping it, and change it if the two do not separate instantly.
- **Do** let the mark inherit `currentColor` so one asset serves both themes; size it with the
  class (`size-5` at 20px in the sidebar, `size-4` at 16px in the header).
- **Do** state limits plainly in UI copy when the system reaches one, and never claim durability,
  privacy or safety the system does not deliver.

### Don't:

- **Don't** introduce decorative gradients, glows or coloured washes. There are none in the
  product and they would undercut an instrument reading.
- **Don't** add spot illustration, 3D renders or mascot imagery. Icons are functional Lucide
  glyphs that carry information.
- **Don't** put a shadow on a card, row, column or panel. (The board card's resting `shadow-xs`
  is existing drift, not a precedent.)
- **Don't** use a solid Destructive fill. Destructive actions are text plus a 10% tint.
- **Don't** add a second typeface, a monospace face, or `font-bold`.
- **Don't** tint the neutrals. Every grey in both themes is zero-chroma `oklch(L 0 0)`, and a
  warm or cool cast would make the semantic hues read as part of a palette.
- **Don't** interpolate a network-supplied colour string into a style attribute. Peers supply a
  validated hue number; anything else is a CSS injection.
- **Don't** give the product an identity glyph from the circle family, or any other shape the
  status set already owns. A mark that collides with a status reading costs the status, not the
  mark.
- **Don't** colour the mark, gradient it, or give it a brand hue. It is foreground grey in both
  themes, and a branded exception would be the first decorative colour in the product.
- **Don't** fork the mark's geometry between the component and the favicon. Only the stroke
  weight may differ (2 in-app, 2.6 in the tab), and only because 2px does not survive 16px of
  browser chrome.
- **Don't** soften the focus ring to a translucent blend. At this token a `/50` ring measures
  2.32:1 against the background versus 7.44:1 solid, so the blend cannot clear 3:1.
