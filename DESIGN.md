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
  muted-foreground: 'oklch(0.53 0 0)'
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
- Motion that is brief (100–200ms) and fully removable — the one long beat is news from a peer,
  and it moves nothing but opacity

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
- **Dimmed Ink** (`oklch(0.53 0 0)` light / `oklch(0.708 0 0)` dark): secondary text, timestamps,
  placeholder, and the `none`/`low` priority glyphs — the deliberate "this is present but not the
  point" register. Darker than shadcn's stock `oklch(0.556)` on purpose: secondary text also sits on
  Shelf and on translucent input fills, where the stock step measured 4.35:1 and missed 4.5:1; 0.53
  measures 4.82:1 on Shelf and 5.25:1 on Paper (reasoning beside the token in `layout.css`).
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

The same number, with the same `--peer-l`/`--peer-c`, colours everything that says "a person did
this": the avatar disc, the remote-change trace on a row or card, and the off-screen notice's
avatar. A peer the browser cannot name gets Dimmed Ink, never an invented hue — a colour would
claim an identity.

**The trade-off it carries.** Peer hues and the status hues share a lightness band, so some land
within a just-noticeable step of a signal colour: light h≈140–180 beside Done Emerald, h≈45 beside
In-Progress Amber, dark h≈12 beside Destructive. On an avatar that is harmless, because the disc
holds initials and a circle of initials is a person. On a row, a frame in one of those hues sat a
few pixels from the status glyph and read as status — a green box round a Todo row looked like
"done". So **peer hue never appears on a row or card without the peer's initials beside it**:
the trace always brings the author's disc (see Remote Change Trace). The hue says _which_
person at a glance; the initials are what make it a person at all.

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

**The address bar is the workspace link.** Internal links carry no `?ws=` (the session
remembers its workspace, so `resolve()` calls stay clean), and the root layout writes the
session's id back as `?ws=` after every navigation, the first included, with `replaceState` and
focus and scroll kept. So the URL a visitor copies to their phone is the one Share copies, and
"anyone with this link" in the route's caption is literally true. It reloads instead of rewriting
only when the URL names a _different_ valid workspace, because rewriting that would silently drop
the workspace someone was sent to; the root redirect `/` → `/issues` keeps the query for the
same reason.

Two list surfaces, two strategies. The issue list is **virtualized** (virtua) inside a single
scroll container with a `rounded-lg border` frame, and holds 10,000 rows without degrading. Across
all statuses it is sectioned in board column order, each section headed by the board column's own
header grammar (status glyph, `text-sm font-medium` label, secondary count badge) on the Shelf
fill at 32px against the row's 41, so a heading never reads as the cursor row. Filtered to one
status it has no headings; the filter button already names the section. Board
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
- **Floating notice** (`shadow-md` + `ring-1`, the floating-layer pair): the remote-change notice,
  which is pinned to the viewport above the list rather than placed in it.

`shadow-none` appears six times in the codebase as a deliberate removal of an inherited default,
which is part of the same doctrine.

### Named Rules

**The Depth Means Floating Rule.** If a surface is in the document flow, it has no shadow. A
shadow on a card, row, panel or column is a defect, not a style choice — border and tonal fill are
how this system separates things.

Board cards carried a resting `shadow-xs` for long enough to be recorded here as known drift —
the one in-flow shadow in the product. It is gone: a card separates from its column by border and
the column's recess, like every other in-flow surface, and `issues/depth.test.ts` reads the class
strings of the board card and the list row so the utility cannot quietly come back.

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

- **Glyphs:** Issues is `list-todo`, Board `square-kanban`, Search `search`. Issues was
  `circle-dot` — a status glyph (In Progress) in chrome, against the Circle Belongs to Status
  Rule — and its replacement was chosen by the 16px Adjacency Check: rendered on a 1x display
  beside the mark, `panel-left`, `square-kanban` and the five status circles in both themes.
  `ticket`'s side notches echo the mark's split seams; `layout-list` and `rows-3` merge into
  `panel-left` and `square-kanban`. `list-todo` is open strokes and a tick — no ring, no closed
  panel — and is also the glyph of the /issues empty state, so the two read as one place.
- **Footer:** "Keyboard shortcuts" is a small `MenuButton` that opens the shortcuts sheet, with
  the `?` chip beside it. It was a caption, which on a phone (where the chip hides) pointed at
  nothing, for a sheet only the `?` key could open.

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

### Remote Change Trace

What a peer's edit leaves where it lands: the row or board card it changed. Real-time sync is the
one thing every visitor comes to check, and before this it arrived in milliseconds and left no
mark at all.

- **Look:** an overlay under the host's content and over its fill (the host is
  `relative isolate`): a 2px inset edge plus a 12% wash, both in the author's peer colour, and the
  author's 18px initials disc in flow beside the row's viewer stack (in the card's footer on the
  board). The overlay never tints the focus ring or the selection fill it sits over. No left
  stripe, no bounce, no layout shift beyond the disc's own 18px.
- **Who:** the disc is not optional decoration; it is what keeps the hue from reading as status
  (see Peer Identity). It is skipped when the author is already in that row's viewer stack, so
  one face is never drawn twice. An unnamed author gets a Dimmed Ink trace and no disc.
- **Timing — the one long beat:** 1200ms, opacity only: an 8% rise, a hold to 40%, then a long
  ease out. This is a sanctioned exception to 100–200ms, and the reason is the rule's own: that
  budget is for feedback on something the viewer did, and this is _news about something they did
  not_, noticed from the corner of an eye. A peer typing commits every 400ms; a continuation of a
  lit trace starts at full strength (`TRACE_HOLD_FROM_MS`) so the row holds steady rather than
  blinking, and a row re-rendered mid-trace resumes where it was.
- **Reduced motion:** the fade is replaced by a state — no animation, full trace, removed by the
  same 1.2s timer. The blanket reduce block would otherwise cut it to 0.01ms and end it on the
  invisible last keyframe, removing the information along with the motion.
- **Assistive tech:** `aria-hidden`. A polite live region in the presence bar says it once,
  coalesced: bursts settle for 0.5s and become one sentence, two announcements are at least 2s
  apart, and an edit is said once its author has left that issue alone for 1s, with the title it
  ended on — never the half-word of a peer's first pause.

### Remote Notice

When the changed row is not on screen (moved to another section, filtered out, deleted), one
line at the foot of the viewport says it instead: the author's avatar and "Ada Lovelace moved
'Fix login' to Done". 12px, up to two lines (the destination is the end of the sentence, and one
truncated line at phone width cut exactly that), floating-layer shadow and ring, 4s, no controls
and `pointer-events-none`. Fixed to the viewport rather than the list, because at short heights
the list's own foot is off-screen too. It never scrolls the list. It fades in at 150ms for news
and only rewrites its sentence for a peer still typing on the same issue. It is shown only when
the trace cannot be seen, judged once the row has had the frames it needs to render, so the two
never say the same thing twice. `aria-hidden`, because the live region already said it.

### Second-Window Invitation

The product demonstrating its own claim: an outline `xs` button, "Open a second window", followed
by "— edits merge both ways, even offline." as one 12px Dimmed Ink sentence. It opens the share
URL with `noopener`, so the second window arrives exactly as an invited person would. Prose, not
a flex row (beside a fixed-width button the claim broke into four lines at 320px), at
`leading-6` so the line holding the button is no taller than one without it, and balanced so the
phone-width break falls at the dash. Shown only while the relay is ready and nobody else is here;
the second peer arriving is what removes it.

### Keyboard Hints (Kbd)

12px `font-medium` Dimmed Ink on Shelf, 20px tall, never wrapping and never shrinking (a chip is
one key or one chord). **Hidden on touch-only devices** — `(pointer: coarse) and (hover: none)`
— by the component itself, so no call site can forget: on a phone the "C" on New issue advertises
a key the visitor does not have. Coarse _and_ no hover, so an iPad with a trackpad and a touch
laptop keep their hints. The shortcuts sheet, whose subject is the keys, opts back in with
`showOnTouch`.

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
  its own reduced-motion opt-out — WAAPI timings ignore the CSS block entirely. The exceptions
  are news rather than feedback and move only opacity: the 500ms quick-add flash and the 1200ms
  remote-change trace, which under reduced motion becomes a state, not a shorter fade.
- **Do** put a peer's initials beside any peer hue drawn on a row or card. The hue says which
  person; the initials are what keep it from reading as a status.
- **Do** let `Kbd` decide whether a hint shows on touch; opt in with `showOnTouch` only where the
  keys are the subject.
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
- **Don't** put a shadow on a card, row, column or panel. `depth.test.ts` holds the board card and
  the list row to it.
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
