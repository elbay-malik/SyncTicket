# SyncTicket Roadmap

Thirteen phases from empty repo to deployed, documented, local-first issue tracker. Each phase has a goal, acceptance criteria (AC), an evening-hours estimate, and the `src/lib/` directory it introduces — directories are created in the phase that needs them, never earlier.

Distilled from the full research pathway (mid-2026); library pins verified against npm on 2026-07-08. **Re-verify any pin with `npm view <pkg> version` at install time.**

| #   | Phase                             | Goal & acceptance criteria                                                                                                                                                                                                                      | Est.    |
| --- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | **Bootstrap & styled shell** ✅   | Repo pushed; CI fully green (`check` incl. `wrangler types --check`, lint, Vitest unit + browser, Playwright e2e, build, `wrangler deploy --dry-run`); dark/light/system toggle without SSR flash; `/issues` placeholder renders. Not deployed. | 6–8 h   |
| 2   | **Domain model & persistence** ✅ | Y.Doc schema (issues as `Y.Map` entries, ordering via fractional-indexing) + y-indexeddb. AC: an issue created with the network off survives a hard reload; doc keyed by workspace ID. Introduces `sync/`, `model/`.                            | 8–10 h  |
| 3   | **Runes bridge & query index** ✅ | `.svelte.ts` bridge exposing Yjs state as `$state`; `$derived` filter/sort/group index. AC: unit tests prove Yjs mutation → reactive update; no legacy stores anywhere. Introduces `state/`.                                                    | 8–12 h  |
| 4   | **Issue CRUD UI** ✅              | Create dialog, detail sheet, inline edits, status/priority badges. AC: full CRUD offline; every mutation reflected within one frame; keyboard submit. Introduces `components/issues/`.                                                          | 10–14 h |
| 5   | **Kanban board**                  | svelte-dnd-action (`onconsider`/`onfinalize`). AC: drag within/between columns persists via fractional keys, offline-safe, no ordering collisions in tests.                                                                                     | 8–10 h  |
| 6   | **Virtualized lists @ 10k**       | svelte-virtuallists (fallback: @tanstack/svelte-virtual). AC: 10k seeded issues scroll smoothly; interactions stay responsive; memory bounded. ADR due: virtual-list library choice.                                                            | 6–8 h   |
| 7   | **Command palette & keyboard**    | Real ⌘K palette with actions (create, set status, navigate); central shortcut registry. AC: every core flow is mouse-free. Introduces `keyboard/`.                                                                                              | 6–8 h   |
| 8   | **In-browser search**             | FlexSearch lexical index + Transformers.js v4 (all-MiniLM-L6-v2) embeddings in a module Web Worker; hybrid ranking. AC: zero network calls at query time; lexical results while the model warms. Introduces `search/`. ADR due: search engine.  | 12–16 h |
| 9   | **Realtime relay**                | `workers/relay/` — separate Worker, y-partyserver `YServer`, WebSocket Hibernation, `new_sqlite_classes` migration. AC: two browsers converge <1 s; DO hibernates when idle; fits free-plan quotas; app worker unchanged.                       | 10–14 h |
| 10  | **Presence & awareness**          | Yjs awareness: avatars, active-issue indicators, board cursors. AC: disconnects clear presence within seconds.                                                                                                                                  | 6–8 h   |
| 11  | **Sync resilience & offline UX**  | Connection status UI. AC: airplane-mode edits merge cleanly on reconnect; a concurrent-edit demo scenario is scripted and documented.                                                                                                           | 6–8 h   |
| 12  | **Demo polish & first deploy**    | Seeded demo workspace; share-URL flow; production `wrangler deploy` of both workers. AC: a fresh visitor is productive in under a minute.                                                                                                       | 6–10 h  |
| 13  | **Whitepaper README & ADR final** | README rewritten as a technical whitepaper (architecture diagrams, measured numbers from phases 6/8/9, tradeoff narrative); ADR statuses finalized. AC: every major decision is understandable from the README alone.                           | 6–8 h   |

**Total remaining after Phase 4: ~70–96 h.**

## Phase risks & notes

- **Phase 2** — y-indexeddb has not been published since Nov 2023: it is small, mature, and the de-facto standard, but if it ever breaks, the fallback is a Dexie-backed custom provider. fractional-indexing jumped to 4.0.0 — review its changelog before writing ordering keys to persistent storage.
- **Phase 3** — the CRDT-to-runes bridge is the architectural heart; if it feels wrong here, pivot before investing further (the documented fallback is ElectricSQL + PGlite, see ADR 0001).
- **Phase 4** — the detail sheet is a route (`/issues/[id]`), so its code is a separate chunk: the issues layout calls `preloadCode('/issues/*')` on mount, without which the first navigation after going offline has no code to fetch. Editable fields use a nullable-draft pattern in a keyed child component — `{#key}` re-creates DOM but _not_ the enclosing component's `$state`, so drafts would otherwise leak between issues.
- **Phase 5** — svelte-dnd-action supports Svelte 5 but its docs are still Svelte 3/4-flavored; use `onconsider`/`onfinalize` handler props consistently. **Order-key collisions:** two replicas creating their first issue offline both mint `"a0"` (fractional keys are deterministic from local state). Display order already converges via the sort's id tiebreak (Phase 3), but drag-to-reorder must not call `generateKeyBetween` on two equal keys — it throws. Generate reorder keys with a per-replica disambiguator / jitter, or reconcile duplicate keys on merge, before shipping reordering.
- **Phase 6** — svelte-virtuallists is ~16 months without a release; @tanstack/svelte-virtual (very active) is the documented fallback.
- **Phase 8** — WebGPU is not universal: Transformers.js auto-falls back to WASM; gate the model download behind explicit user action if it hurts first-load vitals. FlexSearch 0.8 has a substantially different API from the 0.6/0.7 most blog posts cover.
- **Phase 9** — y-websocket is now 3.x (major ahead of most tutorials); we use partysocket's `YProvider` instead. Verify the y-partyserver `YServer` API against the cloudflare/partykit README at install time. Free-plan DOs are SQLite-backend only (`new_sqlite_classes`), 100k req/day, 13k GB-s/day — Hibernation keeps idle duration near zero.
- **Phase 12** — `wrangler deploy --dry-run` (CI) does not validate account-level concerns: workers.dev subdomain, name availability, quotas. Expect small surprises at first real deploy.

## Library pins (verified 2026-07-08)

```
yjs@13.6.31                    # v14 is in beta — do NOT adopt mid-project (doc encoding compat)
y-indexeddb@9.0.12             # dormant since 2023-11 — works; Dexie-provider is the fallback
y-websocket@3.0.0              # for reference; we use partysocket's YProvider
y-partyserver@2.2.0            # DO relay (Cloudflare-stewarded, active)
partysocket@1.3.0              # client provider
dexie@4.4.4                    # optional derived query index
fractional-indexing@4.0.0      # major bump vs 3.x — check changelog before persisting keys
svelte-dnd-action@0.9.70       # Svelte 5: onconsider/onfinalize
svelte-virtuallists@1.4.2      # stale; fallback: @tanstack/svelte-virtual@3.13.31
@huggingface/transformers@4.2.0  # Transformers.js v4 (WebGPU + WASM fallback)
flexsearch@0.8.212             # lexical fallback; 0.8 API differs from old blog posts
better-auth@1.6.23             # only if real accounts ever needed (ADR 0004)
```

Rejected during research: **y-durableobjects** (dormant since 2025-08, single maintainer), **Rocicorp Zero** (no offline writes), **Triplit** (acquired, future uncertain). Details in [ADR 0001](adr/0001-sync-engine-yjs-over-electricsql-and-zero.md).
