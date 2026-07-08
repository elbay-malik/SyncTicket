# 0001 — Sync engine: Yjs CRDT + Durable Object relay

**Status:** Accepted
**Date:** 2026-07-08

## Context

SyncTicket's headline requirement is genuine local-first operation: the browser must own a full, mergeable copy of workspace data, work offline indefinitely, stay consistent across tabs, and converge after concurrent edits — all on a 0 € backend. Candidates evaluated (mid-2026):

- **Yjs 13.6.31** — the production-default CRDT (~900k weekly downloads), with y-indexeddb for IndexedDB persistence/multi-tab, an awareness API for presence, and sequence CRDTs that give collaborative text editing on issue descriptions for free.
- **ElectricSQL + PGlite** — Postgres read-path sync into a WASM Postgres in the browser, pgvector included. Compelling relational/pgvector story, but the write path is bespoke, and Electric needs an always-on Elixir service holding a replication slot — not deployable on Workers free tier (~4 €/month Hetzner or Electric Cloud).
- **Rocicorp Zero** — its own docs state "Zero does not support offline writes"; disqualifying for an offline-first flagship. Also needs a stateful Node sync server + Postgres.
- **Triplit** — acquired by Supabase (Oct 2025); the product is not being integrated and the domain parks. Rejected on maintenance risk.
- Relay libraries for Yjs-on-Durable-Objects: **y-partyserver 2.2.0 + partysocket 1.3.0** (Cloudflare-stewarded in the cloudflare/partykit monorepo, active through June 2026, `YServer extends Server extends DurableObject`, Hibernation support) vs **y-durableobjects 1.0.5** (well-made but dormant since 2025-08, single maintainer, Hono peer dep) vs raw **y-websocket 3.x** (would mean hand-rolling the DO plumbing).

## Decision

Use Yjs as the source of truth — one Y.Doc per workspace, persisted with y-indexeddb — and sync it through a Cloudflare Durable Object relay built on y-partyserver, with partysocket's YProvider as the client. All querying happens client-side over a derived, rune-backed index.

## Consequences

- Offline writes, multi-tab consistency, and conflict-free merges come from the CRDT by construction; there is no hand-written sync protocol to get wrong.
- Locked to the Yjs 13.x document encoding: v14 (in beta) must not be adopted mid-project, since all clients and stored snapshots must decode each other.
- Conflict semantics are CRDT semantics: last-writer-wins registers for scalar issue fields (Y.Map), sequence merging for text — these must be documented and tested (conflict-table unit tests, Phase 11).
- No server-authoritative validation in demo mode; the relay is a dumb, replaceable pipe (see ADR 0004 for the trust model).
- ElectricSQL + PGlite + TanStack DB remains the documented fallback if CRDT-shaped data becomes limiting; the pivot checkpoint is the Phase 3 runes bridge.

## Alternatives considered

- **ElectricSQL + PGlite** — strongest relational/pgvector narrative, but breaks the 0 € constraint and adds a bespoke write path.
- **Rocicorp Zero** — no offline writes, by its own documentation.
- **Triplit** — post-acquisition maintenance uncertainty.
- **PowerSync** — mature but a managed black box; weaker "explain the internals" signal for a portfolio piece.
- **y-durableobjects** — matched the architecture but dormant for ~11 months; y-partyserver is Cloudflare-stewarded and current.
