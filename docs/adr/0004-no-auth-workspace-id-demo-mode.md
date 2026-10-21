# 0004 — No auth: unguessable workspace ID as capability URL

**Status:** Accepted
**Date:** 2026-07-08

## Context

The flagship demo is "open this link in a second window and watch it sync." Any signup step kills that moment. The workspace is also the natural sharding unit: one Y.Doc, one Durable Object room, one IndexedDB database. Real authentication would drag in a session store and user table the free-plan architecture doesn't otherwise need.

## Decision

Ship demo mode with no authentication: a workspace is identified by an unguessable random ID (nanoid-length) carried in the URL, acting as a bearer capability — knowing the URL grants read/write. The DO room name and the local IndexedDB database name both derive from this ID. ~~Abuse control is Worker-side rate limiting plus free-plan quotas.~~

**Correction (2026-10-21, relay abuse-control audit).** The struck sentence asserted a control that was never built, and is left struck through rather than deleted because the record should show it. A smaller inaccuracy in the same paragraph belongs with it: the id is not "nanoid-length" — `createWorkspaceId()` mints `w` plus a 32-character hex UUID (`src/lib/model/workspace.ts`), 128 bits, and there is no nanoid in this repo.

What exists now is three things, and only three. First, the relay routes a room only for a name matching the shape the app mints, `^[a-z][0-9a-f]{32}$` (`workers/relay/src/rooms.ts`), checked in `routePartykitRequest`'s `onBeforeConnect` — which the library awaits _before_ it fetches the Durable Object stub, so a refusal creates no object — and every non-WebSocket request to a room is refused with 404, so no plain HTTP request can bring a room into existence. Second, at that same site, a limit of 30 WebSocket upgrades per 60 seconds per client IP via the Workers Rate Limiting binding (`workers/relay/src/limits.ts`); its counters are per Cloudflare location and the API is documented as permissive and eventually consistent, so this turns a flood into a trickle and guarantees nothing. Third, the free plan's daily caps — which are a backstop that kills the demo rather than a control that protects it: exceeding one makes further operations of that type fail until 00:00 UTC.

What none of that stops, stated plainly so nobody has to re-derive it. The 128-bit id means an existing workspace cannot be found by brute force, but the relay's check is a _shape_ check with no secret in it, so a stranger can **mint** a correctly-shaped name and create an empty room; the rate limit narrows that rate and does not close the path, and a distributed source walks past a per-location counter. A refused request still costs a Worker request against an account-wide budget of 100,000 per day, so no code in this repo can stop a determined flood from exhausting the free plan for the day and returning Error 1027 for the app worker as well as the relay — that limit is the plan, not the architecture. And nothing limits Yjs messages on an established socket, deliberately: `hibernate: true` evicts any in-memory counter, and a storage-backed one would spend more of the 100,000 rows-per-day write budget than the messages it polices, since inbound messages bill at a twentieth of a request while one counter write costs a whole row.

So the rate limiting here is one narrow bound on the one abuse event that leaves a Durable Object behind. It is not the general abuse control the struck sentence implied. Anyone with the URL can still read and write.

(The Rate Limiting binding's availability on the Workers **Free** plan is unverified — Cloudflare documents no plan gate, but no primary source affirmatively confirms Free. `refuseConnect` fails open on an unbound or throwing binding, so if it turns out to be paid-only the relay behaves exactly as it did before, and this note is what says so.)

## Consequences

- Sharing is a copy-paste of the URL; the two-window demo is frictionless.
- No real or sensitive data must ever be entered into a workspace; the README/demo page must say so.
- Anyone with the URL can write — there is no per-user identity, so presence (Phase 10) uses self-chosen display names via the Yjs awareness API.
- This ADR must be superseded before any non-demo use. The documented upgrade path is better-auth (~1.6.x, already available as an `sv` add-on) with workspace membership checks in the relay's connection handler.
- **Abuse of the request budget takes the whole account's Workers traffic offline** (Error 1027), app worker included, until 00:00 UTC. It is self-healing and destroys nothing, and rate limiting does not delay it — a Worker request is billed on arrival, before any hook runs.
- **Creating a room is not free.** partyserver persists the room name on first initialisation (`ctx.storage.put('__ps_name', …)`) and `onLoad` creates the snapshot table, so each fabricated room spends a row write and leaves SQLite storage that, unlike the daily counters, does not reset at midnight — against a 5 GB free account cap. There is no cheap way to enumerate or delete such rooms selectively, which is why preventing their creation is the only available lever.
- **Two failure modes are not self-healing, are not prevented by rate limiting, and are tracked as durability defects rather than abuse.** Exhausting the 100,000 rows-per-day write budget makes the relay's `onSave` throw while rooms still appear to sync — y-partyserver swallows that into a `console.error` — and a document whose full Yjs state update exceeds the 2 MB row ceiling can no longer be saved at all. The 2 MB ceiling is not plan-split, so upgrading does not remove it. (Measured since: a never-edited workspace reaches it at roughly 3,000–6,000 issues, and edit churn is the weaker route — `gc` reclaims ~95% of deleted content, leaving ~17–20 bytes per deleted issue, so tombstones alone need tens of thousands of created-and-deleted issues. The blob half is now reported rather than silent — see [ADR 0010](0010-relay-snapshot-durability.md) — which does not raise the ceiling. The rows-per-day half stays open, and is the failure 0010 reports generically because its error shape is unverified.)
- **If room creation ever needs closing rather than narrowing**, the fix is a signed workspace id — random bytes plus a truncated HMAC, verified statelessly in `onBeforeConnect`. It requires server-side minting, which changes the id format, and the id is also the IndexedDB database name and the DO room name, so every existing demo URL and e2e fixture would break in one commit. A documented option, not a plan.

## Alternatives considered

- **Better Auth from day one** — real accounts, but adds signup friction to the demo and a session store to the free-plan budget; deferred, not rejected.
- **Anonymous device IDs + allowlists** — more complexity than the demo threat model warrants.
- **Guessable/short workspace IDs** — trivially enumerable; unguessable IDs are the entire security model, so they must stay long and random.
