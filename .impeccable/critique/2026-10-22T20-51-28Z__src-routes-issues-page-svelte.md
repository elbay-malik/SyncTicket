---
target: /issues surface
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/elbaymalik/dev/eleo/sync_ticket/src/routes/issues/+page.svelte"
target_fingerprint: "sha256:609401bf6cc34b1c7439c07197a76ffa1c8dcd00b50612d9de664207a537678a"
target_path: /Users/elbaymalik/dev/eleo/sync_ticket/src/routes/issues/+page.svelte
timestamp: 2026-10-22T20-51-28Z
slug: src-routes-issues-page-svelte
---
Method: dual-agent (A: design review · B: detector + browser evidence). Not degraded.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Status label visible from sm, hidden entirely below it — a bare cloud glyph remains |
| 2 | Match System / Real World | 3 | "Board order" names a concept that does not exist on this page |
| 3 | User Control and Freedom | 3 | Undo works and is documented but has no pixel on screen — keyboard-only |
| 4 | Consistency and Standards | 2 | button rings solid 2px; input/textarea/input-group still ship stock ring-ring/50 at ring-3 |
| 5 | Error Prevention | 3 | Delete confirms and focuses Cancel; a status change is still instant and silent |
| 6 | Recognition Rather Than Recall | 2 | Row titles render as plain body text with no link affordance; no status legend on the surface |
| 7 | Flexibility and Efficiency | 4 | Roving tabindex, j/k, pickers via arrows, Cmd+K, undo — and the sheet lists it |
| 8 | Aesthetic and Minimalist Design | 3 | Two create affordances 20px apart; 14 rows as one undifferentiated block |
| 9 | Error Recovery | 3 | connectionCopy is outstanding; Share swallows a refused clipboard silently |
| 10 | Help and Documentation | 3 | Sheet good and now includes undo; its one visible signpost is not clickable |
| **Total** | | **29/40** | **Good (was Acceptable at 27)** |

All ten applied; none n/a. Assessment A reached 29/40 independently.

## Design Specificity Verdict

Still not grounded. Vocabulary is specific (achromatic field, hue reserved for status, mark drawn from the card radius, seed data that is the product's own backlog); composition is a competent Linear-shaped list any tracker could ship. The claim is now on screen but quiet: one 12px muted line top-right, "Saved locally · Ready to share", gone below sm. The surface asserts sync and demonstrates it nowhere — Share copies a URL, says "Copied" for 2s, and never suggests that opening it in a second window is the demo.

Deterministic scan: 0 findings, and weaker than it looks. The file scan is regex-only, and the URL scan boots a fresh browser with empty IndexedDB so it only ever saw the EMPTY state — no rows, pickers, badges or sheet. B proved the engine was not silently failing by running a known-bad control (exit 2, expected rules).

Visual overlays: skipped — no user-visible browser tab in this harness.

## What's Working

1. The keyboard model, now with undo in the sheet; all 13 tab stops have visible indicators and pickers correctly are not tab stops.
2. connectionCopy plus the icon substitution — three independent facts kept independent, alert glyph replacing the cloud rather than joining it.
3. The previous fix batch holds under independent measurement: Cmd+K hint 4.82, sheet Delete 4.65, palette placeholder 4.90, zero targets under 24x24, undo removes the issue and is listed.

## Priority Issues

[P1] Quick-add input focus ring is 2.32:1 light / 2.34:1 dark vs SC 1.4.11's 3:1, while every other control rings at 5.54-7.46:1. Found independently from source and from a live Tab walk. button.svelte was fixed with a comment explaining the measurement; input/textarea/input-group still carry stock ring-ring/50 at ring-3, the exact blend DESIGN.md's Don't forbids. Hits the first control a visitor touches. Fix: match the button, then assert solid rings across primitives so a shadcn re-add fails a test. Command: /impeccable audit

[P1] The durability answer is hidden on mobile: at 390px and 320px the header is a bare cloud glyph with no text. PRODUCT.md says evaluators arrive often on a phone, and a wordless cloud reads as "it's in the cloud" — the opposite of the claim. Command: /impeccable adapt

[P1] Undo has no pixel on screen. It works, is scoped correctly and is in the sheet, but a mouse user in a no-auth shared workspace cannot reach it. Command: /impeccable onboard

[P2] The surface never invites the second window. peerCount === 0 is the moment for one sentence — "Open this link in a second window — edits merge both ways" — with Share as the action and a second peer arriving as the dismissal condition. Command: /impeccable clarify

[P2] Fourteen rows, no grouping, under a label that teaches nothing. Statuses fully interleaved; the board answers the same question instantly with columns. Command: /impeccable layout

## Persona Red Flags

The ninety-second hiring manager: finds the sync claim at 12px in the far corner, quieter than the "bug" chip on row one, and nothing demonstrating it. Concludes "clean, competent Linear clone".
Jordan: row titles look like static text; two creates 20px apart; the "Keyboard shortcuts ?" signpost is a div that does nothing.
Sam: the one soft focus ring is on the primary input; undo is keyboard-only with no visible control.
Casey: durability text gone, label chips gone below sm, 11 of 14 titles truncated.

## Minor Observations

- `hidden: true` does not work on the help sheet: the registry has a `listed` getter that filters it, the sheet reads `all`. Harmless today (it is why j/k appear) but the flag silently does not do what it says.
- DESIGN.md has drifted: it documents the input at 36px / 8px radius; shipped is h-8 (32px) / rounded-lg (10px).
- Status picker in the sheet overshoots the viewport by 1.3px at 320px.
- Sheet's Status/Priority look like static text while Assignee/Labels look editable — the richer controls look inert.
- Share's refused-clipboard path is a bare return.

## Findings that did not survive verification

A's P0 "status glyphs absent on first paint" is dismissed. The artifact is real (light capture lacks glyphs, dark seconds later has them) but the mechanism is impossible: every icon is a static import in meta.ts, the same module as STATUS_UI, so if the row renders the icon is loaded. Two live checks (warm, and HTTP cache disabled) show 14/14 glyphs at first visibility. Screenshot rasterization artifact, not a defect.

Run one's "j/k appear nowhere in the shortcuts sheet" was false; B measured them present and the code confirms the sheet never filters hidden entries.

B's own 3.74:1 contrast item is correctly a non-finding — the disabled Add button, exempt under WCAG 1.4.3, and B flagged it as such rather than padding the count.
