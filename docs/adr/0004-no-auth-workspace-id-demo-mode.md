# 0004 — No auth: unguessable workspace ID as capability URL

**Status:** Accepted
**Date:** 2026-07-08

## Context

The flagship demo is "open this link in a second window and watch it sync." Any signup step kills that moment. The workspace is also the natural sharding unit: one Y.Doc, one Durable Object room, one IndexedDB database. Real authentication would drag in a session store and user table the free-plan architecture doesn't otherwise need.

## Decision

Ship demo mode with no authentication: a workspace is identified by an unguessable random ID (nanoid-length) carried in the URL, acting as a bearer capability — knowing the URL grants read/write. The DO room name and the local IndexedDB database name both derive from this ID. Abuse control is Worker-side rate limiting plus free-plan quotas.

## Consequences

- Sharing is a copy-paste of the URL; the two-window demo is frictionless.
- No real or sensitive data must ever be entered into a workspace; the README/demo page must say so.
- Anyone with the URL can write — there is no per-user identity, so presence (Phase 10) uses self-chosen display names via the Yjs awareness API.
- This ADR must be superseded before any non-demo use. The documented upgrade path is better-auth (~1.6.x, already available as an `sv` add-on) with workspace membership checks in the relay's connection handler.

## Alternatives considered

- **Better Auth from day one** — real accounts, but adds signup friction to the demo and a session store to the free-plan budget; deferred, not rejected.
- **Anonymous device IDs + allowlists** — more complexity than the demo threat model warrants.
- **Guessable/short workspace IDs** — trivially enumerable; unguessable IDs are the entire security model, so they must stay long and random.
