# SyncTicket Roadmap

Thirteen phases from empty repo to deployed, documented, local-first issue tracker. Each phase has a goal, acceptance criteria (AC), an evening-hours estimate, and the `src/lib/` directory it introduces — directories are created in the phase that needs them, never earlier.

Distilled from the full research pathway (mid-2026); library pins verified against npm on 2026-07-08. **Re-verify any pin with `npm view <pkg> version` at install time.**

| #   | Phase                             | Goal & acceptance criteria                                                                                                                                                                                                                      | Est.    |
| --- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | **Bootstrap & styled shell** ✅   | Repo pushed; CI fully green (`check` incl. `wrangler types --check`, lint, Vitest unit + browser, Playwright e2e, build, `wrangler deploy --dry-run`); dark/light/system toggle without SSR flash; `/issues` placeholder renders. Not deployed. | 6–8 h   |
| 2   | **Domain model & persistence** ✅ | Y.Doc schema (issues as `Y.Map` entries, ordering via fractional-indexing) + y-indexeddb. AC: an issue created with the network off survives a hard reload; doc keyed by workspace ID. Introduces `sync/`, `model/`.                            | 8–10 h  |
| 3   | **Runes bridge & query index** ✅ | `.svelte.ts` bridge exposing Yjs state as `$state`; `$derived` filter/sort/group index. AC: unit tests prove Yjs mutation → reactive update; no legacy stores anywhere. Introduces `state/`.                                                    | 8–12 h  |
| 4   | **Issue CRUD UI** ✅              | Create dialog, detail sheet, inline edits, status/priority badges. AC: full CRUD offline; every mutation reflected within one frame; keyboard submit. Introduces `components/issues/`.                                                          | 10–14 h |
| 5   | **Kanban board** ✅               | svelte-dnd-action (`onconsider`/`onfinalize`). AC: drag within/between columns persists via fractional keys, offline-safe, no ordering collisions in tests. Mouse and keyboard dragging.                                                        | 8–10 h  |
| 6   | **Virtualized lists @ 10k** ✅    | virtua (neither pin: see ADR 0005). AC: 10k seeded issues scroll smoothly; interactions stay responsive; memory bounded. Board columns capped rather than virtualized.                                                                          | 6–8 h   |
| 7   | **Command palette & keyboard** ✅ | Real ⌘K palette with actions (create, navigate, theme); central shortcut registry; list cursor; `?` help sheet. AC: every core flow is mouse-free. Introduces `keyboard/`.                                                                      | 6–8 h   |
| 8   | **In-browser search** ✅          | FlexSearch lexical index + Transformers.js v4 (all-MiniLM-L6-v2) embeddings in a module Web Worker; hybrid ranking via RRF. AC: zero network calls at query time; lexical results while the model warms. Introduces `search/`.                  | 12–16 h |
| 9   | **Realtime relay** ✅             | `workers/relay/` — separate Worker, y-partyserver `YServer`, WebSocket Hibernation, `new_sqlite_classes` migration. AC: two browsers converge <1 s; DO hibernates when idle; fits free-plan quotas; app worker unchanged.                       | 10–14 h |
| 10  | **Presence & awareness**          | Yjs awareness: avatars, active-issue indicators, board cursors. AC: disconnects clear presence within seconds.                                                                                                                                  | 6–8 h   |
| 11  | **Sync resilience & offline UX**  | Connection status UI. AC: airplane-mode edits merge cleanly on reconnect; a concurrent-edit demo scenario is scripted and documented.                                                                                                           | 6–8 h   |
| 12  | **Demo polish & first deploy**    | Seeded demo workspace; share-URL flow; production `wrangler deploy` of both workers. AC: a fresh visitor is productive in under a minute.                                                                                                       | 6–10 h  |
| 13  | **Whitepaper README & ADR final** | README rewritten as a technical whitepaper (architecture diagrams, measured numbers from phases 6/8/9, tradeoff narrative); ADR statuses finalized. AC: every major decision is understandable from the README alone.                           | 6–8 h   |

**Total remaining after Phase 9: ~24–40 h.**

## Phase risks & notes

- **Phase 2** — y-indexeddb has not been published since Nov 2023: it is small, mature, and the de-facto standard, but if it ever breaks, the fallback is a Dexie-backed custom provider. fractional-indexing jumped to 4.0.0 — review its changelog before writing ordering keys to persistent storage.
- **Phase 3** — the CRDT-to-runes bridge is the architectural heart; if it feels wrong here, pivot before investing further (the documented fallback is ElectricSQL + PGlite, see ADR 0001).
- **Phase 4** — the detail sheet is a route (`/issues/[id]`), so its code is a separate chunk: the issues layout calls `preloadCode('/issues/*')` on mount, without which the first navigation after going offline has no code to fetch. Editable fields use a nullable-draft pattern in a keyed child component — `{#key}` re-creates DOM but _not_ the enclosing component's `$state`, so drafts would otherwise leak between issues.
- **Phase 5** — resolved as follows (installed 0.9.79, not the 0.9.70 pin; `onconsider`/`onfinalize` are typed handler props in that version). **Order-key collisions** were addressed twice over: order keys now carry a random suffix so two replicas do not mint the same key, and `planRepairs` heals any equal keys that already exist before a drop computes a position. The suffix cannot simply be appended — `generateKeyBetween` frequently returns a proper _prefix_ of the upper bound, and appending there sorts past it — so `orderKeyBetween` descends toward the bound and retries. Event handling is not what the docs suggest: a keyboard drop reports through `consider` (`dragStopped`) with no `finalize`, while every arrow press fires a `finalize` mid-drag, so commits are keyed off the source and trigger rather than the event name (`components/issues/board-drag.ts`).
- **Phase 6** — resolved with **virtua 0.51.0**, neither the pin nor the documented fallback ([ADR 0005](adr/0005-virtual-list-virtua-over-tanstack-and-svelte-virtuallists.md)): svelte-virtuallists is now 18 months stale, and `@tanstack/svelte-virtual`'s Svelte adapter returns a legacy `svelte/store` `Readable`, which the runes-only rule forbids. Measuring first showed the query index was never the bottleneck (2 ms to filter and sort 10k) — the DOM was, at 5.0 s and 168k nodes. Virtualization and drag-and-drop are mutually exclusive, so board columns are capped at 100 cards instead.
- **Phase 7** — a document-level shortcut is a hostile thing to get right, and three of the traps only show up in a real browser. `Enter` and the arrow keys must **not** be global: a handler that preventDefaults them suppresses button activation, link navigation and form submission everywhere, so the list owns its own cursor keys and Enter stays ordinary link activation. `⌘K` must be allowed inside overlays as well as inputs or it can open the palette but never close it, and bits-ui's Command reads Ctrl+K as "previous item" unless `vimBindings={false}`. A chord for `?` has to match the character the keyboard _produces_, not Shift plus a US-layout key.
- **Phase 8** — done; the pin held up under measurement ([ADR 0006](adr/0006-search-flexsearch-lexical-with-optional-local-embeddings.md)). FlexSearch 0.8's API is indeed unlike the 0.6/0.7 material: `limit` is per _field_, the document generic rejects an `interface`, and indexing title and description as separate fields makes a two-word query spanning both return nothing. The model is opt-in as the note advised. **Left for Phase 12:** `onnxruntime-web` makes the bundler emit a 22.5 MB WASM asset that is never served (the runtime fetches its own from jsDelivr); rollup's `external` does not govern assets emitted through `new URL`, so suppressing it needs a small plugin — or self-host the runtime and model deliberately, which would also make a cold start fully offline.
- **Phase 9** — done. Two corrections to the plan above: the Yjs provider lives in **`y-partyserver/provider`** (a default export), not in `partysocket`, which exports no Yjs provider at all and is never imported; and partyserver routes by kebab-casing the **Durable Object binding name**, so the client must ask for party `y-doc-room` — its default of `main` is answered with HTTP 400. Also landed here rather than Phase 12: a workspace id carried in the URL and remembered, because with a relay a single shared room makes every test (and every visitor) share one workspace.
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
