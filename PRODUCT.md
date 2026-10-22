# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Three audiences, all of them **evaluators** rather than people with issues to track. Confirmed
with the owner: the person opening the demo is not the end the product serves — they are the
evidence.

- **Hiring managers and tech leads.** Arrive from a CV or portfolio link, skim, click the live
  demo, and form a judgement in minutes. Non-engineers among them judge feel and finish before
  anything else.
- **Engineers judging the technique.** Peers and open-source readers who care about CRDTs,
  local-first architecture and Durable Objects. They read the ADRs and the source; the running
  demo is their proof the claims are not aspirational.
- **Freelance clients and prospects.** Assessing whether the owner can deliver finished product
  work. They weigh the demo's polish far above its architecture.

The **demo visitor** — whoever opens a share link and tracks a few issues — is instrumental.
Their fluency within a minute is what the three audiences above actually read.

## Product Purpose

A working local-first, real-time collaborative issue tracker, built to demonstrate competence
on the hard parts of that problem: CRDT sync, offline correctness, distributed liveness, and
in-browser ML. Success is an evaluator concluding, from the artifact rather than from prose,
that the owner can build a non-trivial system and finish it.

It is a portfolio piece that happens to be a real application, not a product seeking users.

## Positioning

The browser owns the data. A Yjs document in IndexedDB is the source of truth, not a cache of a
server, so every mutation is local-first and instant by construction and the relay is a thin,
replaceable WebSocket server whose only job is letting two browsers learn about each other's
edits. Merging and offline queueing come from the CRDT, not hand-rolled sync code.

Two commitments a neighbouring demo could not truthfully copy:

- **It runs at 0 €.** Both workers are on Cloudflare's free plan, with hibernating WebSockets
  so idle rooms cost nothing. The free-tier ceilings are treated as design constraints to be
  surfaced honestly, not limits to hide.
- **Search needs no third party, including for the model.** Lexical search is always available;
  semantic search is opt-in and the embedding model and ONNX runtime are self-hosted (~46 MB),
  with remote models switched off so a missing local file fails loudly into lexical-only rather
  than silently reaching Hugging Face or jsDelivr.

## Operating Context

- **Evaluation, not adoption.** The common path is: README or portfolio → live demo → maybe the
  ADRs. Minutes, often on a phone, usually once.
- **The demo is a scripted two-browser walkthrough.** `docs/DEMO.md` is the script, and it is
  also a Playwright test (`e2e/demo.e2e.ts`) in which every sentence quoted from the connection
  popover is asserted as an exact string — so the documented demo cannot drift from the app.
- **Sharing is a link.** Pressing Share copies an invite URL; opening it in another browser
  joins the same workspace. A browser never given the link sees nothing.
- **Deployed and live.** App at `syncticket.eleo-666.workers.dev`, relay at
  `syncticket-relay.eleo-666.workers.dev`, both on the free plan, first deployed 2026-10-22.

## Capabilities and Constraints

Confirmed functionality: issue CRUD with a create dialog and detail sheet; a Kanban board with
mouse **and** keyboard dragging; virtualized lists tested at 10,000 issues; a command palette
and a full keyboard model (every core flow is mouse-free); presence and awareness; truthful
connection and persistence status; offline editing that merges on reconnect; share-link
collaboration; lexical search with optional local semantic search.

Durable constraints:

- **No authentication, permanently.** Confirmed: this stays a demo. A workspace is identified by
  an unguessable 128-bit id carried in the URL, acting as a bearer capability — knowing the link
  is the access. This is a settled product fact, not a stage to be grown out of, so future work
  never introduces accounts, and nothing in the product may describe itself as a private tracker.
- **Free-plan ceilings are product limits.** 100,000 requests/day and 100,000 rows written/day,
  account-wide. A workspace stops being saved by the relay at roughly **6,130 issues**
  (measured: 307.6 encoded bytes per issue against a 1.9 MB snapshot guard under Cloudflare's
  2 MB row cap). The product's answer is to say so in plain language rather than fail silently.
- **Abuse control is narrow and must not be overstated.** 30 socket upgrades per 60 seconds per
  IP, measured permissive in production (60 concurrent attempts yielded 42 connections). The
  room-name check is a shape check with no secret: a stranger can mint a routable name. This
  turns a flood into a trickle and guarantees nothing.
- **Local storage can be refused.** A browser that blocks IndexedDB still syncs, but its edits
  do not survive the tab. The product states this rather than implying safety it lacks.

Terminology, used consistently in product and code: **workspace** (one shared document, one
URL), **issue**, **relay** (the WebSocket server), **room** (the relay's per-workspace Durable
Object), **snapshot** (the stored document).

Explicitly undecided or absent, and not to be invented: no real users, no customers, no
testimonials, no pricing, no licensing, no usage metrics, no uptime claims.

## Brand Commitments

- **Name: "SyncTicket" is a working title**, confirmed open to change. It currently appears in
  the document title, the sidebar and the docs. Future work may propose a stronger name without
  treating it as a breaking change.
- **There is no identity of its own yet, and this is a gap to fix.** The favicon is the stock
  **Svelte logo** shipped by the SvelteKit scaffold (`src/lib/assets/favicon.svg`, titled
  `svelte-logo`) — placeholder, not a nod to the stack. The wordmark is plain text in two
  places. Future work is licensed to design a real mark; shipping a framework's logo as the
  product's identity undercuts the three audiences above.
- **Voice: rigour is binding in the docs, lighter in the UI.** The README and ADRs keep their
  precise, measured register, including the refusal to overclaim ("It guarantees nothing";
  struck-through corrections preserved with dated notes). Product copy may be warmer and
  shorter for a first-time visitor — but the substance of that refusal is not negotiable in
  either place: UI copy never claims durability, privacy or safety the system does not deliver.
  "Not saved — this browser blocked local storage" is the standard, not the exception.

## Evidence on Hand

Real, and unusually load-bearing for a portfolio piece — the artifact is the argument:

- **A live deployment**, verified by a human in two browsers rather than by the absence of a
  deploy error.
- **`README.md`**, written as a technical whitepaper with measured numbers.
- **Ten ADRs** in `docs/adr/`, immutable once accepted, with corrections struck through and
  dated rather than rewritten — a record of decisions reversed as well as taken.
- **423 unit and component tests, 48 end-to-end tests**, and `pnpm ci:local`, which mirrors CI
  step for step and prints what it deliberately cannot check.
- **Measured figures**, not estimates: bytes per issue, Yjs wake cost per struct, snapshot
  crossover, rate-limiter permissiveness, contrast ratios recomputed from installed Tailwind
  source rather than trusted from a checked-in number.
- **`docs/DEMO.md`**, a two-minute script that is simultaneously an executable test.

Absent, and not to be fabricated: no testimonials, no named customers, no adoption or
performance claims beyond the measurements above, no awards, no press.

## Product Principles

1. **The artifact is the argument.** Every claim must be checkable by opening the demo or the
   source. Prose that the running product does not back up is a liability, because the primary
   audiences are specifically there to check.
2. **Never overstate what the system delivers.** Durability, privacy and abuse control are each
   stated at their real strength, to the person using the product as well as to the reader.
   Surfacing a limit honestly is a feature of this product, not an admission.
3. **The browser owns the data; the server is replaceable.** Anything that makes the relay
   load-bearing for correctness is a regression, not a feature.
4. **Free-tier ceilings are design inputs.** 0 € is a fixed constraint. When a limit is reached,
   the product says so in plain language instead of failing silently.
5. **Minutes, not sessions.** An evaluator is productive within a minute or forms their
   judgement anyway. The first viewport carries the proof.

## Accessibility & Inclusion

**WCAG 2.2 AA across the app** is the stated target, confirmed by the owner: future surfaces are
held to it and shortfalls are defects, not judgement calls.

Already enforced by tests rather than asserted:

- **Non-text contrast (1.4.11).** Status and priority badges render icon-only in rows and board
  cards, so the icon carries the information and must clear 3:1. Colours are per-theme, and
  `meta.test.ts` recomputes every ratio from the installed Tailwind and app CSS, so collapsing
  them back to one shared step fails the suite.
- **Landmark and skip-link contract.** One `<main id="main-content" tabindex="-1">` owned by the
  root layout, one `<nav>`, and the skip link ahead of the sidebar. `e2e/a11y-shell.e2e.ts` is
  the guard.
- **Reduced motion**, in both halves: a CSS block for every generated animation utility, and a
  JS opt-out for motion driven through `element.animate()`, which ignores CSS durations.
  Asserted in `e2e/reduced-motion.e2e.ts` and `board-drag.test.ts`.
- **Keyboard completeness.** Every core flow is operable without a mouse, including dragging
  cards between board columns.
