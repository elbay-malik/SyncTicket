---
target: /issues surface
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/elbaymalik/dev/eleo/sync_ticket/src/routes/issues/+page.svelte"
target_fingerprint: "sha256:609401bf6cc34b1c7439c07197a76ffa1c8dcd00b50612d9de664207a537678a"
target_path: /Users/elbaymalik/dev/eleo/sync_ticket/src/routes/issues/+page.svelte
timestamp: 2026-10-25T13-38-29Z
slug: src-routes-issues-page-svelte
---
Method: dual-agent (A: design review · B: detector + browser evidence). Not degraded. Run against a relay-backed dev server, so connection state was real ("Ready to share" → "Shared with 1").

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Connection status exemplary; a peer's edit lands in 3–29 ms with no visible or announced signal |
| 2 | Match System / Real World | 3 | "Open this link in a second window" — the address bar shows no link; "Board order" now true but still unexplained on a list |
| 3 | User Control and Freedom | 3 | Visible Undo, Cmd+Z/Shift+Cmd+Z, Esc everywhere |
| 4 | Consistency and Standards | 2 | /board overflows the shell at 1280 (1536px) and clips the shared header's Share/Undo/theme; circle-dot on the Issues nav and empty state breaks the Circle Belongs to Status Rule |
| 5 | Error Prevention | 3 | Copying the address bar to another device silently opens a fresh, empty workspace |
| 6 | Recognition Rather Than Recall | 3 | Left/Right in-row picker walk missing from the shortcuts sheet; Low priority glyph reads as punctuation |
| 7 | Flexibility and Efficiency | 3 | Strong keyboard model; palette opens on "Next issue", no bulk or single-key status |
| 8 | Aesthetic and Minimalist Design | 3 | Restrained, coherent in both themes; the product's claim is the quietest text on the page |
| 9 | Error Recovery | 3 | Invalid-link notice exemplary; Share failure tells screen readers the link is in a tooltip that does not contain it |
| 10 | Help and Documentation | 3 | ? sheet and palette good; nothing shows how to see the sync beyond one 12px sentence |
| **Total** | | **29/40** | **Good (flat vs 29)** |

All ten applied; none n/a. Assessment A reached 29/40 independently; synthesis moved one point from 5 to 4 after verification (see below).

## Design Specificity Verdict

The words are product-specific; the composition is not. Sidebar → h1 with count → primary button → quick-add → filter/sort → list → right sheet → Cmd+K is the stock shadcn/Linear tracker skeleton; strip about six caption strings and any tracker could ship it. Every local-first and sync claim lives at the bottom of the type scale (12px, muted), and nothing in layout or motion responds when sync happens. The system DESIGN.md describes is implemented faithfully; the thing the product exists to prove leaves no trace on screen.

Deterministic scan: CLI 0 findings across src/routes/issues, the root layout, components/issues and components/shell; engine proven live by a known-bad control (exit 2: side-tab, gradient-text, ai-color-palette). Browser overlay (headless, injected): empty state clean; populated, sheet and help states report one page-level `flat-type-hierarchy` (h2 14px vs h1 18px, step 1.14:1). That finding is accurate on sizes but measured against a 16px document body the rows do not use, and it collides with DESIGN.md's deliberate Four-Step Rule (hierarchy by weight before size) — accepted by design, not a defect.

Visual overlays: injected and executed in a headless browser only; no user-visible [Human] tab exists in this harness.

## What's Working

1. Honest status built into structure: banner and popover share `connectionCopy`, so they cannot disagree; the alert glyph replaces the cloud when the relay cannot save; offline is announced. Principle 2 made mechanical.
2. The keyboard model, measured: one tab stop in the list before and after moves, j×16 visits all 14 rows across 5 section headings without ever landing on one, focus returns to the originating row after the sheet, every stop rings at ≥4.68:1.
3. Presence in context: row viewer avatars, "X is also viewing this issue" in the sheet, and an invite that disappears when the peer it asked for arrives.

## Priority Issues

[P1] Remote edits arrive invisibly. Both assessments, independently: B measured A→B status changes landing in 3, 14, 29, 3, 3 ms with no class change, flash, toast or live-region announcement; the row simply jumps sections and often leaves the viewport. Text fields commit only on blur, so a peer typing shows nothing at all. Real-time sync is the one thing every audience came to check, and its arrival is the least visible event in the product. Fix: mark remote-origin changes (the transaction origin is known) with a brief trace on the row in the author's peer hue — peer identity is one of DESIGN.md's four sanctioned hue uses — leave a short "Moved to Done by <peer>" trace when a row changes section, and announce throttled remote changes politely. Command: /impeccable animate

[P1] /board overflows the shell at 1280 and clips the shared header. Verified: document scrollWidth 1536 at a 1280 viewport; Share, Undo and the theme toggle are pushed off-screen, and the status reads "Saved locally · R". One click from /issues, on the most common laptop width, on the header that carries the product's claim. Fix: `min-w-0` on the inset so the board scrolls inside main, not the page; add a reflow assertion for /board like the one /issues has. Command: /impeccable adapt

[P2] The first viewport carries neither proof. A fresh visitor lands on an empty dashed box with an outline "Load example issues"; once seeded, the top of the list is five grey Backlog rows; the second-window invitation is a 12px muted sentence about a link the address bar does not show. Fix: make seeding the primary action (or seed a fresh, unshared workspace), and promote the invite to one line with an action that opens the share URL in a new window. Command: /impeccable onboard

[P2] The address bar is not the workspace link. Deliberate (workspace.ts keeps `?ws=` out of internal links; the id is remembered locally), but an evaluator copying the URL to a phone gets a fresh empty workspace, silently, and concludes sync is broken. Fix is an owner decision: replaceState the share URL into the address bar, or keep it out and say so where "this link" is mentioned. Command: /impeccable clarify

## Persona Red Flags

The ninety-second hiring manager: lands on an empty box; the thesis is a grey 12px sentence; seeing sync takes Share → second window → edit, and the edit produces no visible moment; copying the address bar to a phone shows an unrelated empty workspace. Leaves with "competent shadcn tracker".
Alex: palette opens on "Next issue" rather than issue search; changing status from the list takes Right, Enter, arrows; no bulk select.
Sam: Left/Right in-row walk is undocumented in the sheet; remote changes are never announced; the Share failure message points to a tooltip without the link (share-workspace.svelte:51 vs :69); relay-status is the one control on the browser's default 1px focus outline rather than the 2px ring.
Casey: "Saved locally" is hidden below lg (by design since the last batch, but the local-first half of the claim is the half that goes); the "C" kbd chip shows on a touch New issue button; at 320 the quick-add placeholder cuts to "Add an issue and press" and the sheet's Assignee to "Unassigne"; 13 of 14 titles truncate at 390.

## Minor Observations

- Circle-dot on the Issues nav (app-sidebar.svelte:56) and the empty state (+layout.svelte:383) breaks DESIGN.md's Circle Belongs to Status Rule.
- Esc in a sheet field reverts the draft with no recovery. Deliberate cancel semantics (issue-editor.svelte:61-66, second Esc closes), but 24 typed characters vanish unrecoverably; undo cannot reach an uncommitted draft.
- Nothing after the list is reachable by Tab; the sidebar's "Keyboard shortcuts ?" is not focusable.
- Measured muted-foreground is oklch(0.53); DESIGN.md documents 0.556.
- Dark "Delete" passes at 4.64:1 — narrowly.
- The sheet's overlay hides the list, so a status change made in the sheet cannot be watched landing.

## Findings that did not survive verification

A's P1 "Esc discards drafts" is real behaviour but documented intent (revert-then-close), so it is a minor observation, not a priority issue. A's "mobile loses the claim" is the trade the previous batch made on purpose (durability at every width, storage from lg). B's overlay small-target hits were the overlay's own buttons. B's first focus pass caught rings mid-transition; the 400ms rerun shows them fully drawn.

## Questions to Consider

- If sync is the product, why does nothing on screen move when it happens — and isn't the peer-identity hue exception exactly for this?
- Should a workspace with no `?ws=` in the address bar exist at all?
- For an audience that visits once, often on a phone, is "open a second window" the right proof — or should the page carry its own second view?
