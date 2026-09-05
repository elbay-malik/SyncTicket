# 0005 — Virtualized lists: virtua, and a cap for the board

**Status:** Accepted
**Date:** 2026-09-05

## Context

Phase 6 requires a 10,000-issue workspace to stay responsive. Before choosing anything, the current list was measured in Chromium with 10,000 seeded issues:

| Measurement (10,000 issues)            | Value        |
| -------------------------------------- | ------------ |
| Seed into the Y.Doc (one transaction)  | 92 ms        |
| `filterIssues` + `sortIssues` over 10k | 2.0 ms       |
| Render every row                       | **5,019 ms** |
| `<li>` elements                        | 10,000       |
| DOM nodes                              | **168,011**  |
| One field edit reaching the DOM        | 0.7 ms       |

This settled what the problem actually was. The Phase 3 query index scales fine — filtering and sorting the whole set costs 2 ms, and a single edit still lands in under a millisecond with everything mounted. The DOM is the entire problem: seventeen nodes per row, mostly the two dropdown-menu triggers, rendered ten thousand times.

Four candidates were evaluated against the installed packages rather than their documentation (versions as of 2026-09-05):

| Library                  | Version | Last published | Runes-native              | Sizing                    | List semantics      |
| ------------------------ | ------- | -------------- | ------------------------- | ------------------------- | ------------------- |
| svelte-virtuallists      | 1.4.2   | 2025-03        | yes (snippets)            | automatic                 | `div` only          |
| @tanstack/svelte-virtual | 3.13.36 | 2026-08        | **no** — `Readable` store | manual                    | manual              |
| virtua                   | 0.51.0  | 2026-08        | yes (snippets)            | automatic                 | `as` / `item` props |
| svelte-tiny-virtual-list | 4.0.0   | 2026-08        | yes (snippets)            | **explicit pixel height** | `div` only          |

The roadmap's original pin, svelte-virtuallists 1.4.2, has not been published since March 2025. Its documented fallback, `@tanstack/svelte-virtual`, is actively maintained but its Svelte adapter returns `Readable` from `svelte/store` — a legacy store, which this repo bans outright (AGENTS.md, "Runes only"). svelte-tiny-virtual-list requires an explicit pixel height, which would mean hand-rolling a `ResizeObserver` for a responsive column.

## Decision

Use **virtua 0.51.0** (`virtua/svelte`) for the issue list, via its `Virtualizer` component rather than the self-contained `VList`, so the item element can be a real `<li>` inside a real `<ul>`.

Do **not** virtualize the Kanban board. Cap each column at 100 rendered cards instead, passing the ids behind the cap along as ordering context on a drop.

## Consequences

- **The list is bounded.** Re-measured after the change: rendering costs 33 ms instead of 5,019 ms, with 20 `<li>` and 383 DOM nodes instead of 10,000 and 168,011. Roughly 150× faster, 440× fewer nodes.
- **List semantics survive**, so every existing test and screen-reader affordance that depends on `listitem` still works. This is why `Virtualizer` was chosen over `VList`, which renders only `div`s.
- **The row is no longer the list item.** `issue-row.svelte` renders the row's _contents_; virtua owns the `<li>` because it has to position and measure it. Row styling that relied on the parent (`divide-y`) moved to a per-item border.
- **The list owns its own scroll container**, since virtua measures the virtualizer's direct parent. The page no longer scrolls as a whole on `/issues`; the toolbar stays put and the list scrolls, which is also the Linear-like layout this project is imitating.
- **The board is capped, not virtualized, and that is a real limitation.** svelte-dnd-action requires every item to be a direct child of the drop zone, so a rendered window would hide the rest from the drag machinery entirely — the two techniques are mutually exclusive. Measured at 10,000 issues, one column held 2,028 cards at 907 ms and 38,979 DOM nodes; capped at 100 it costs 194 ms and 1,922 nodes. A column past the cap says so and points at the list view.
- **A capped column still orders correctly.** The drop handler appends the hidden ids after the visible ones, so a card dropped at the bottom of a capped column sorts in front of the first card the user cannot see rather than after the whole column.
- virtua ships adapters for five frameworks in one package. Only `virtua/svelte` and its core are imported, but the package is larger on disk than a Svelte-only library would be.
- Bulk seeding (`sync/seed.ts`) exists now for benchmarking and is the groundwork for the Phase 12 demo workspace.

## Alternatives considered

- **svelte-virtuallists 1.4.2** — the roadmap's pin, and runes-native, but eighteen months without a release for a load-bearing dependency, and it renders `div`s only.
- **@tanstack/svelte-virtual 3.13.36** — the best-maintained option, but its Svelte adapter is store-based, which contradicts the runes-only rule this project has followed since ADR 0003. Adopting it would mean either breaking that rule or wrapping the store by hand.
- **svelte-tiny-virtual-list 4.0.0** — small and current, but demands an explicit pixel height; a responsive list would need its own resize plumbing.
- **Virtualizing the board too** — impossible without replacing the drag library, since svelte-dnd-action indexes the drop zone's direct children positionally.
- **Rendering the whole list and optimising the row** — the row would have to lose both dropdown pickers to get near the budget, and 10,000 rows would still cost far more than 383 nodes.
