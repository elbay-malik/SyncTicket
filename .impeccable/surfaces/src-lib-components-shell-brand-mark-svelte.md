---
version: 1
slug: "src-lib-components-shell-brand-mark-svelte"
primary_target: "src/lib/components/shell/brand-mark.svelte"
related_targets: ["src/lib/assets/favicon.svg","src/lib/components/shell/app-sidebar.svelte","src/routes/+layout.svelte"]
---

Scope: the product mark — favicon plus the in-app mark beside the wordmark in the sidebar and header. Visitor mode: Operate (the mark lives on the app shell, not on a marketing surface), so the build is code-led by contract.

Audience: the three evaluator audiences in PRODUCT.md — hiring managers, engineers judging the technique, freelance clients. Job: recognise the product as a product. Today the app ships the SvelteKit scaffold's Svelte logo, so the one piece of identity every visitor sees belongs to the framework.

Constraints: the name is a working title, so no letterform and no wordmark investment — the wordmark stays as Geist type. DESIGN.md's Colour Means State Rule holds for the mark too, confirmed with the user: the mark is achromatic. It must read at 16px in a browser tab and at 20px beside the sidebar wordmark, in both themes.

Unresolved: none. A social/OG card was offered and declined for now.

## Direction contract

THESIS: The mark states the mechanism, not the category. A ticket, a checkmark, a clipboard or a kanban glyph would say "issue tracker", which is the thing this product is least interested in proving; two forms resolving into one says "these two copies agree", which is the one claim a neighbouring tracker could not truthfully make. Refuses the category default of an object-from-the-domain mark, and refuses the monogram, which the provisional name would make worthless.

OWN-WORLD: Pure greyscale, zero chroma, in the Lucide stroke grammar the app already uses — 24px box, 2px stroke, round caps — but deliberately NOT in its circle family. This app ships six circle glyphs (circle, circle-dashed, circle-dot, circle-dot-dashed, circle-check, circle-x), five of them the issue statuses rendered icon-only, so a ring or a ring-with-dot is not a free shape: it already means something. The mark therefore takes the system's other form language, the soft rectangle of its cards and panels (4.5 corner radius in the 24 box), split into two halves closing on one shared centre point. `currentColor` throughout, so it inherits foreground in both themes and needs no dark variant. No fill, no gradient, no second asset.

STORY: The visitor sees a mark that shares the app's stroke grammar — 24px box, 2px stroke, round caps — while being the only non-circular glyph on screen, and reads the product as something designed rather than scaffolded. An engineer sees one document split into two halves closing on a single shared value, and recognises the merge. The mark is deliberately not of the status family: that family carries meaning, and identity does not belong in it.

FIRST VIEWPORT: In the sidebar, a 20px mark immediately left of the "SyncTicket" wordmark at the existing 14px semibold. In the app header, the same mark at 16px before the wordmark — the confirmed scope, and the only mark on screen at 390px and 320px where the sidebar is collapsed. In the browser tab, the same geometry at 16px with its stroke thickened to 2.6 to survive the size. Primary action unchanged — the mark is not interactive and takes no focus.

FORM: Convergence — two copies closing on one agreed value, chosen from four concepts (convergence, the circle family's parent, monogram, instrument reading) and ranked first on product clarity. No concept roll ran and none was owed: new-work §3 exempts a narrow extension of an established world from the tournament, and that world was committed and documented in DESIGN.md earlier the same day. There is therefore no seed reference to record — not an unavailable one, an absent one, because no roll was taken.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
