---
target: /issues surface
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:/Users/elbaymalik/dev/eleo/sync_ticket/src/routes/issues/+page.svelte"
target_fingerprint: "sha256:609401bf6cc34b1c7439c07197a76ffa1c8dcd00b50612d9de664207a537678a"
target_path: /Users/elbaymalik/dev/eleo/sync_ticket/src/routes/issues/+page.svelte
timestamp: 2026-10-22T14-15-30Z
slug: src-routes-issues-page-svelte
---
Method: dual-agent (A: design review · B: detector + browser evidence). Not degraded.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Relay/persistence state is one unlabelled 14px muted glyph; quick-add returns no feedback; no row timestamps |
| 2 | Match System / Real World | 3 | Default sort labelled "Manual order" on a list that cannot reorder (SORT_LABEL.manual; list never writes `order`) |
| 3 | User Control and Freedom | 2 | Zero UndoManager references in src/ — no undo in a Yjs app; a mis-clicked status rewrites shared state irreversibly |
| 4 | Consistency and Standards | 3 | /board has a keyboard hint, /issues does not; relay-status is the only control using the UA outline, not the project ring |
| 5 | Error Prevention | 3 | Delete confirms with title quoted, focus on Cancel; quick-add fires into shared state with no undo |
| 6 | Recognition Rather Than Recall | 2 | Status/priority icon-only with no on-surface legend; j/k registered hidden:true, absent from the shortcuts sheet |
| 7 | Flexibility and Efficiency | 3 | Strong keyboard model, almost entirely undiscoverable |
| 8 | Aesthetic and Minimalist Design | 3 | "SyncTicket" renders twice in one viewport ~190px apart, each with a mark |
| 9 | Error Recovery | 3 | Best writing in the product, but dismissing the durability banner is permanent |
| 10 | Help and Documentation | 3 | Shortcuts sheet derived from registry (cannot drift); reachable only via `?` or a 12px non-interactive-looking row |
| **Total** | | **27/40** | **Acceptable (top of band)** |

All ten heuristics applied; none scored n/a.

## Design Specificity Verdict

Not grounded. Strip the mark and this is a competent Linear-shaped list; every structural decision is a genre decision. Verified: the local-first sentence and the ADR 0004 disclosure both live inside `{#if query.total === 0}` at +layout.svelte:333, so both vanish permanently on "Load example issues". Remaining on-screen evidence for a CRDT product: one unlabelled 14px cloud glyph, one avatar, one Share button. connectionCopy() is excellent, e2e-tested string-by-string, and entirely behind that glyph.

Deterministic scan: 2 advisory findings, both design-system-font-size (text-[10px] at board-column.svelte:239 and issue-row.svelte:88). No false positives — DESIGN.md's ramp stops at 12px.

Visual overlays: skipped — the overlay targets a [Human] browser tab this harness does not have.

## Overall Impression

The engineering is better than the surface it produces. An evaluator spending ninety seconds sees a static grey list that ends on stillness, for a product whose claim is liveness. The proof is already written and tested; it is not on screen.

## What's Working

1. The keyboard model inside the virtualized list — focus IS the cursor, keepMounted derived from tabbableIndex, cursor moves rAF-coalesced. All 13 tab stops verified to render a visible indicator.
2. Icon-only badges as a checked position: hue reserved for status, therefore 1.4.11 3:1, steps chosen by measured ratio, meta.test.ts recomputing from installed Tailwind.
3. Focus and escape across overlays: dialog, sheet, palette and popover all trap focus and close on Escape; the sheet returns focus to the originating row.

## Priority Issues

[P0] The product's thesis and its required disclosure live only in the empty state. Evaluators judge the populated list, which contains no evidence of the claim; ADR 0004 requires telling visitors before they type anything real, but the notice disappears the moment they do. Fix: move the disclosure into the shell permanently; give relay status a visible text label collapsing to the glyph below sm:. Command: /impeccable clarify

[P1] The detail sheet is clipped at 390px and 320px. It lays out inside the sidebar-offset container, so w-full is not the viewport: 240px wide in a 320px viewport, Title/Assignee/Labels bleeding past its right edge (critique-320-sheet.png, critique-390-sheet.png). Command: /impeccable adapt

[P1] No undo, and quick-add is silent. Enter appends after max order, so the new row lands off-screen in a virtualized list; the field clears and nothing else happens. Fix: select + scrollToIndex the new row (both mechanisms exist), flash it within the reduced-motion contract, then wire Y.UndoManager. Command: /impeccable onboard

[P2] Three light-mode contrast misses against a stated AA target: ⌘K hint 4.35, sheet Delete 3.97, palette placeholder 4.43 (need 4.5). Dark mode has none. One SC 2.5.8 failure: relay-status button 26x22. Command: /impeccable audit

[P2] Focus return is wrong on two overlays: closing the status picker lands on the row link, not the trigger; the command palette returns focus to <main>. Command: /impeccable harden

## Persona Red Flags

Jordan (first-timer): two create affordances 10px apart; icon-only status/priority with no legend; quick-add returns nothing; the one sentence explaining the app is deleted by their own first action.

Sam (keyboard/screen reader): j/k hidden:true and absent from the shortcuts sheet; the sheet reachable only via ? or a 12px div that looks like a legend; status-picker focus return breaks list position. Refuted by B: focus indicators present on all 13 tab stops.

The ninety-second hiring manager (project-specific): reads "SyncTicket" twice in one viewport; 14 rows with no timestamp, activity or second person; Share is a silent clipboard write with no hint that opening it elsewhere is the demo; leaves on a motionless list.

## Minor Observations

- Brand mark: downgraded from A's P2. The adjudication render (critique-adjacency-big.png) does not support "reads as circle-dot-dashed" — at 16/20/32px the mark is square-cornered with a heavy dot vs a thin round ring with a tiny one. Residue: shares an enclosure-plus-dot gestalt with circle-dot at 16px.
- text-[10px] at two sites, a fifth type size against the Four-Step Rule (both agents agree).
- Board card clamps a long title to 3 lines hiding ~2/3 with no affordance; board keyboard hint cut off at 1440.
- List frame ends ~90px below the last row, reading as an unresolved loading state.
- Content column capped at max-w-3xl while titles truncate at 390px, leaving ~200px of empty gutter.
- Only one heading (h1 Issues) in the document; the sheet title is sr-only and not an h*.
- ShareWorkspace swallows a clipboard rejection silently.

## Questions to Consider

1. If an evaluator only saw desktop.png, what would they say this does that Linear doesn't?
2. Why is the best writing in the product behind a 14px unlabelled glyph?
3. Is ADR 0004's "told before they type anything real" met, or only met where nothing is at stake?
4. No undo in a Yjs app — scope decision or oversight?
5. What should be moving at the end of a ninety-second visit?
