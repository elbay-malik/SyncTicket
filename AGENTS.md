# AGENTS.md — conventions for coding agents (and humans)

Commands, conventions, and stale-training-data traps. Rationale lives in `docs/adr/`.

## Toolchain

- **pnpm only** (`packageManager` pins `pnpm@11.10.0`). Use `pnpm dlx` / `pnpm exec`, never npm/npx. Node 24 via `.nvmrc` (fnm auto-switches).
- Postinstall build scripts are allowlisted in `pnpm-workspace.yaml` (`allowBuilds`: workerd, esbuild, …). If `pnpm install` reports newly blocked builds, add them there — don't run interactive `pnpm approve-builds`.
- `pnpm check` must pass; both `check` and `build` regenerate `worker-configuration.d.ts` (`wrangler types`) rather than validate it — its content legitimately varies with build state (wrangler adds a `mainModule` import only when `.svelte-kit/cloudflare/_worker.js` exists), so `--check` can never be stable across CI and local. The file is committed (IDE needs it), prettier- and eslint-ignored; don't fight small diffs in it.

## Svelte / TypeScript

- **Runes only** (`$state` / `$derived` / `$effect`); no legacy stores. Shared reactive state goes in `.svelte.ts` modules under `src/lib/state/`.
- mode-watcher 1.x: read `mode.current` (not the old `$mode` store); set via `setMode()` / `resetMode()`.
- TS is strict + extras; `exactOptionalPropertyTypes` is deliberately off (ADR 0003) — don't re-enable it.
- `checkJs` must also stay off: `worker-configuration.d.ts` imports the built worker entry, so after any build the JS bundle artifacts enter the TS program and would fail `pnpm check`.
- Navigation needs `resolve()` from `$app/paths` (eslint `svelte/no-navigation-without-resolve`); the rule is disabled only for the generic `ui/` primitives.
- Reactive collections use `SvelteMap`/`SvelteSet` from `svelte/reactivity` (eslint enforces it in `.svelte.ts`); a transient non-reactive `Set` still trips the rule, so avoid it — prefer `.clear()` + repopulate.

## Data layer (Phases 2–3)

- **The Y.Doc is the source of truth.** Three layers, one direction: `model/` = plain types + pure functions (no Yjs, no runes); `sync/` = the only place that (de)serialises a `Y.Map`; `state/` = the runes bridge that observes Yjs and projects into a `SvelteMap`. `sync/` must never import from `state/` or `components/`; `model/` has zero runtime deps.
- **Never mutate the projection directly.** UI writes go through `IssueStore.create/update/remove` → the CRDT → `observeDeep` → the projection. The `SvelteMap` is derived state, not a store.
- **Issue field writes stay in a `doc.transact()`** so one issue change is one observer batch. Order keys come from `fractional-indexing` (`generateKeyBetween`) — append with `nextOrderKey`; never reuse a key.
- **Persistence attaches synchronously** (static `y-indexeddb` import, browser-guarded) — a dynamic import reintroduces a lost-write window (see the comment in `persistence.ts`).

## UI (Phase 4)

- **The create dialog and the `c` shortcut live in the root layout** so "New issue" works from the list, the board and the command menu alike. When opening it from another dialog (the command palette), `await tick()` first, or the closing dialog's focus restore fires inside the new one's focus scope.
- **Issue components take `store` as a prop**; only routes call `getIssueStore()`. That is what lets browser-mode tests construct a throwaway `new IssueStore('test-<uuid>')` per test instead of sharing the session singleton.
- **Enum presentation lives in `components/issues/meta.ts`** (`STATUS_UI` / `PRIORITY_UI`: icon + colour). `model/issue.ts` owns labels and ranks only — it must keep zero runtime deps.
- **The detail sheet is a route**, `/issues/[id]`, and the list lives in `issues/+layout.svelte` so it stays mounted behind the sheet. Close with `goto(resolve('/issues'), { replaceState: true, keepFocus: true })` — `replaceState` stops Back from reopening the sheet, `keepFocus` lets the focus scope return focus to the row link.
- **The layout preloads the detail chunk** (`preloadCode('/issues/*')` on mount). Without it the first navigation to an issue after going offline has no code to fetch and lands on an error page.
- **Editable fields use a nullable draft**: `null` means "not editing" and the input shows the live CRDT value, so remote changes flow through. The first keystroke sets the draft; commit writes it and returns to `null`. No `$effect` — drafts are set from DOM events only.
- **Drafts live in a keyed child component** (`issue-editor.svelte` inside `{#key issue.id}`). `{#key}` re-creates DOM but _not_ the enclosing component's `$state`, so drafts declared one level up leak between issues. Same reason the create form is a child of `Dialog.Content`, which bits-ui unmounts on close.
- **`patchIssue` owns the write invariants**, not the UI: unchanged fields are dropped (a re-selected status must not bump `updatedAt` or reach the relay), and a blank title is ignored (`readIssue` only defaults a _missing_ title, so a stored `''` would render forever).
- **Icon-only controls must name their value** — `aria-label="Status: Backlog"`, not "Change status" — and `<Kbd>` inside a button needs `aria-hidden="true"` or it pollutes the accessible name.
- bits-ui notes: `AlertDialog.Action` does **not** close its dialog (manage `open` yourself); menu options are `menuitemradio`, not `menuitem`; a Sheet/Dialog needs a `Title` in _every_ branch or it has no accessible name.

## Relay (Phase 9)

- **The relay is its own workspace package** (`workers/relay`), with its own `wrangler.jsonc`, `tsconfig.json` (standalone — the app's pulls in the DOM lib and the app worker's `Env`) and CI steps. The root `pnpm check` and dry-run never touch it, so it has its own `check` and `dry-run` scripts and CI runs both.
- **The party name is the Durable Object binding name, kebab-cased.** Binding `YDocRoom` ⇒ `/parties/y-doc-room/:room`, and the client must pass `party: RELAY_PARTY`; the provider's default (`main`) is answered with HTTP 400. Rename one and you must rename the other in the same commit.
- **`routePartykitRequest` is async.** `routePartykitRequest(req, env) ?? fallback` is dead code — a Promise is never nullish — and returning it unawaited resolves to `null`, which workerd rejects. Await it, and keep the `satisfies ExportedHandler<Env>` that catches this at compile time.
- **The provider is the default export of `y-partyserver/provider`**, not a named one, and `partysocket` has no Yjs provider despite what older notes said.
- **`PUBLIC_RELAY_HOST` is `host[:port]`, read at build time** through `import.meta.env` (with `envPrefix` widened in `vite.config.ts`). `$env/static/public` hard-fails when unset, and `$env/dynamic/public` does not resolve in browser-mode unit tests. The port matters locally: the provider only picks `ws://` for hosts it recognises as local.
- **Status needs three events, not one.** `status` alone never reports a relay that was never reachable, so `connection-close` and `connection-error` also map to offline. `connected` fires when the socket opens, _before_ state has been exchanged — gate on `synced` for anything that needs the data.
- **Teardown order: relay, then persistence, then the doc.** The provider does not detach on `doc.destroy()`, so a socket left open would apply an inbound sync message to a destroyed document.
- **Every e2e gets its own workspace** (`e2e/fixtures.ts`). A shared relay room otherwise leaks state between tests and across local runs, since the room's storage outlives the process.
- Playwright runs two servers; `use.baseURL` must be set explicitly, because Playwright only infers it from a _single_ `webServer` object. `unrouteAll()` does not remove `routeWebSocket()` routes — switch such a handler with a flag instead.

## Search (Phase 8)

- **Search runs in a module Web Worker** (`search/`), reached only through `new URL('./worker.ts', import.meta.url)` so FlexSearch and the embedding library never enter the server bundle. `vite.config.ts` sets `worker: { format: 'es' }` — the default `iife` cannot code-split a worker and silently inlines dynamic imports, which would ship the embedding library to every visitor.
- **FlexSearch 0.8 traps**, all of them load-bearing ([ADR 0006](docs/adr/0006-search-flexsearch-lexical-with-optional-local-embeddings.md)): `limit` is per _field_, so merge and slice; the document generic rejects an `interface` (use a `type` alias); ids are `string | number`; and title and description must be indexed as one combined field or a query whose words span both returns nothing. Keep all of this behind `search/lexical.ts`.
- **The worker starts at app load**, not on first search — its chunk is fetched when constructed, and an offline user could never fetch it.
- **Query ids are minted on the client** and bumped on every call including a clear, so a slow reply can never repopulate a list the user emptied. Results are ids; resolve them through `store.get(id)` so an edited or deleted issue is never rendered from a stale snapshot.
- **The index follows the CRDT through `IssueStore.onChange`**, which emits one delta per observer batch and a `reset` after the post-load rebuild (that rebuild fires no Y events, so a listener watching only deltas would never see the issues already in the document).
- **Embedding must yield.** ONNX inference is synchronous on its thread; embed in small batches, hand back the message queue between them, drop a document's vector when its text changes, and abandon a batch whose generation counter moved. Only report `hybrid` when every document has a current vector.
- **The palette does its own filtering** (`shouldFilter={false}` plus bits-ui's `computeCommandScore`): bits-ui otherwise scores items against the query and hides the rest, which deletes description-only and semantic matches. Issue items are keyed `issue:<id>`, never by title.
- No test may download the model; the semantic path is exercised by hand, and the e2e proves the lexical path and the absence of network traffic.

## Keyboard (Phase 7)

- **Every shortcut is declared in `keyboard/registry.svelte.ts`**, and the root layout owns the single `keydown` listener. The palette and the `?` help sheet render the registry, so a command and its key cannot disagree.
- **Never register `Enter` or the arrow keys globally.** `handle` calls `preventDefault` on a match, and at document level that kills button activation, link navigation and form submission across the whole app. Cursor keys belong to the widget that has focus — the list handles its own arrows, and Enter is plain link activation.
- **Chords match the character the keyboard produces** (`event.key`), never `event.code`. Shift is ignored for punctuation, because `?` is Shift+/ on a US layout and unshifted elsewhere. Note that Playwright's `press('Shift+/')` sends `key: '/'` while a real keyboard sends `?` — write `press('?')`.
- **A shortcut that must work inside an overlay needs both opt-ins.** `⌘K` lands on the palette's own combobox input inside a dialog, so `allowInInput` alone would make it open-only. The palette also sets `vimBindings={false}`: bits-ui's Command reads Ctrl+K as "previous item" and prevents the default.
- **`Command.Viewport` is required** inside `Command.List`, or `Command.Input` never gets `aria-controls`/`aria-activedescendant` and the highlighted item is not announced.
- **Suspend the registry while another widget owns the keyboard** (`shortcuts.setSuspended`). The board does this during a drag, and clears it on destroy — a stranded suspension kills every shortcut app-wide.
- **The list cursor is roving focus**, not `aria-selected` (invalid on `listitem`, and virtua owns the `<ul>`). Moving the cursor moves real focus so screen readers announce the row; pin the cursor's index with virtua's `keepMounted` or focus cannot land on a row outside the rendered window.
- Single-letter shortcuts are correctly inert while typing, so any text field the keyboard can get stuck in needs an escape hatch (the quick-add field blurs on Escape).

## Virtualization (Phase 6)

- **The issue list is virtualized with `virtua/svelte`'s `Virtualizer`** ([ADR 0005](docs/adr/0005-virtual-list-virtua-over-tanstack-and-svelte-virtuallists.md)) — not `VList`, because only `Virtualizer` takes `as` / `item`, which keeps the rows a real `<ul>`/`<li>` for assistive tech and for every `listitem` locator in the tests.
- **`issue-row.svelte` renders the row's contents, not the `<li>`.** virtua owns the item element so it can position and measure it, and absolutely-positioned items mean parent-based styling (`divide-y`) does not apply — per-item borders come from `itemProps`.
- **The virtualizer sizes itself from its direct parent**, so that parent needs a real height. In the app the layout gives it `min-h-0 flex-1`; in a browser test, mount into a host with an explicit height **and import `routes/layout.css`**, or Tailwind is absent, the container has no height, and the list renders every row while appearing to pass.
- **Do not virtualize the board.** svelte-dnd-action indexes the drop zone's direct children positionally, so a rendered window would hide the rest of the column from the drag machinery. Columns are capped at `BOARD_COLUMN_LIMIT` instead, and the drop handler appends the ids behind the cap so a drop at the bottom of a capped column still sorts correctly.
- **Measure before optimising here.** At 10k the query index costs 2 ms and a single edit 0.7 ms; the DOM was the whole problem. `store.seed(n)` bulk-creates issues in one transaction for benchmarks (and, from Phase 12, demo data).
- Virtualized lists make Chromium emit `ResizeObserver loop completed with undelivered notifications`. It is benign — the browser has already recovered, and the real app logs nothing — but Vitest's error catcher surfaces it as an unhandled error in browser-mode output. It does not fail the run; ignore it.

## Board & ordering (Phase 5)

- **Order-key maths lives in `sync/order.ts`**, not `model/` (it needs `fractional-indexing`, and `model/` keeps zero runtime deps). Generated keys carry a random suffix so two replicas cannot mint the same key; `planRepairs` heals equal or blank keys that already exist, rewriting only the offending run.
- **Never call `generateKeyBetween` directly from UI or board code.** It throws when its bounds are equal, and a blank `order` (which `readIssue` produces for a missing field) crashes it with a `TypeError`. Go through `appendOrderKey` / `orderKeyBetween` / `moveIssue`, which normalise both.
- **`moveIssue` takes the target column's ids in their new order** and does all the key work: it excludes the moved card before repairing (its key is the one deliberately out of place), reads neighbours _after_ repairs, and writes repairs plus the move in one transaction. A pure reorder does not bump `updatedAt`; a status change does.
- **A drag that changes nothing must write nothing.** Jitter means a recomputed key always differs from the stored one, so the guard asks whether the existing key still sorts into the new slot — never whether the strings match.
- svelte-dnd-action facts that are not in its docs, all load-bearing (see `components/issues/board-drag.ts`):
  - A **keyboard drop** arrives as `consider` with trigger `dragStopped` and sends **no** `finalize`. Handling only `finalize` leaves the column frozen on a stale preview.
  - Every **arrow press** fires a full `finalize` mid-drag. Commit on `source === 'pointer'`, or on the `dragStopped` consider — not on every finalize.
  - Releasing outside every column still fires `finalize`, with `droppedOutsideOfAny`. Write nothing.
  - The zone's **direct children must be exactly the items**: the library indexes `node.children` positionally, makes each a draggable, and reads announcements from that element's `aria-label`. No wrappers (an `animate:flip` wrapper silently becomes the card), no empty-state placeholder inside the zone.
  - **Cards must contain nothing focusable.** Only direct children leave the tab order during a drag, and tabbing onto a column is the only way to move a card between columns.
  - Pass `zoneTabIndex: -1`, label the zone and each card with `aria-label`, and restore focus after a keyboard drop — the library leaves it on `<body>`.
- **Drag previews live on the board page, not per column.** A drag ends untidily in the columns it merely passed through, so any ending clears every preview.
- Test drags with the **keyboard**; pointer drop detection polls on a 200 ms timer and animates before reporting.

## Styling

- Tailwind **v4 CSS-first**: there is no `tailwind.config.js` and never will be. Theme lives in `src/routes/layout.css` (oklch variables). Never delete the `@custom-variant dark (&:is(.dark *));` line — it is class-based dark mode.
- shadcn-svelte components in `src/lib/components/ui/` are **owned code** — edit them. Add new ones with `pnpm exec shadcn-svelte add <name>`, then run `pnpm format` (generated code fails `prettier --check`).
- Icons: `@lucide/svelte` (deep imports: `@lucide/svelte/icons/x`). Not `lucide-svelte`, not `cmdk-sv`, not `tailwindcss-animate` — all obsolete.

## Versions

- Never install `@next` dist-tags: kit 3 / adapter-cloudflare 8 are prereleases; the shadcn-svelte/bits-ui `next` tags are _stale pre-1.0 leftovers older than latest_. Check with `npm view <pkg> dist-tags`.
- `compatibility_date` in wrangler.jsonc is capped by the pinned wrangler's bundled workerd — bump them together, then verify with `pnpm preview` (ADR 0002).

## Cloudflare

- **Two-worker rule**: never add Durable Object classes or migrations to the root `wrangler.jsonc`. DOs belong to `workers/relay/` with its own config; the app worker binds cross-script via `script_name` (ADR 0002).

## Tests

- Vitest browser locators are `getByLabelText` / `getByPlaceholder` (Playwright's are `getByLabel` / `getByPlaceholder`) — chaining `getByLabel` off a Vitest locator throws at runtime, not at typecheck.
- `src/**/*.test.ts` → Vitest node project. `src/**/*.svelte.test.ts` → Vitest browser mode (needs `pnpm exec playwright install chromium`). `e2e/*.e2e.ts` → Playwright, whose webServer runs the **built worker under workerd** (`pnpm build && pnpm preview`, port 4173) — not vite preview.

## Commits

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `ci:`); imperative subject ≤ 72 chars.
