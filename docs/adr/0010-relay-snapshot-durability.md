# 0010 — Relay snapshot durability: report the ceiling, do not raise it

**Status:** Accepted
**Date:** 2026-10-21

## Context

The relay stores a workspace as one row: `onSave` writes `Y.encodeStateAsUpdate(doc)` into
`ydoc_snapshot(id, doc)` with `INSERT OR REPLACE`. Cloudflare caps a string, BLOB or row value at
**2 MB**, and that cap is not plan-split — upgrading does not remove it. The limits page's own
footnote defines 1 GB as 1,000,000,000 bytes, and no footnote redefines MB, so the figure to
design against is 2,000,000 rather than 2,097,152. Local workerd happens to accept ~2,199,994
bytes; that is a local `SQLITE_MAX_LENGTH` build constant, not a contract.

Above the cap the write throws, and **the throw is swallowed**. y-partyserver subscribes to the
document's `update` event with a debounced callback that does
`this.onSave().catch((err) => console.error("failed to persist:", err))`
(`y-partyserver/dist/server/index.js`, around lines 185–195). There is no hook, no event and no
client signal. The room goes on relaying in memory and reports perfect health while silently no
longer persisting; at the next hibernation eviction, everything since the last good write is gone.
Nothing in the UI could have told anyone, and `observability` logs are retained for three days on
the free plan — so a failure in week one is not discoverable in week two.

**Measured before deciding** (yjs 13.6.31, documents built to the shape `createIssue` writes):

| description length | issues at 2,000,000 bytes |
| ------------------ | ------------------------- |
| `''`               | 6,116                     |
| ~120 chars         | 4,551                     |
| ~400 chars         | 2,760                     |
| ~1,200 chars       | 1,315                     |

Cost per issue is flat from 100 to 40,000 issues, so the model is just
`bytes ≈ 320 + descriptionLength` — the ceiling is a straight line, which is what makes it worth
guarding rather than engineering around.

Edit churn is the weaker route, not the main one. `new Y.Doc()` defaults to `gc: true`, which
reclaims ~95% of deleted content (1,000 issues created then deleted: 0.3839 MiB → 0.0171 MiB).
What gc cannot collect is the item skeleton and the delete set: ~17–20 bytes per deleted issue for
clean bulk deletes, ~49 when creates and deletes interleave. Reaching 2 MB on residue alone needs
roughly 40,000–100,000 created-and-deleted issues, or ~90,000 field edits on a 500-issue
workspace.

A **second route to the same silent failure** surfaced while measuring: the free plan's
100,000 rows-written-per-day budget is account-wide, and exceeding it makes "further operations of
that type fail with an error" — the same throw, into the same swallow. The old
`callbackOptions = { debounceWait: 300, debounceMaxWait: 2000 }` made this worse than it looks,
because the **trailing** timer is the worst case: any gap longer than `debounceWait` fires a save,
so bursty human typing costs more than continuous editing. At 300 ms that is up to ~288,000 row
writes a day from one room, i.e. one room could exhaust the whole account in about 8.3 hours.

Nothing is deployed yet — CI only runs `wrangler deploy --dry-run` for both workers — so there are
no stored snapshots to stay compatible with. That freedom is used below for a new table, with no
legacy-read branch. It is not, however, an argument for a larger mechanism: being free to change
the schema says something about cost, not about whether a mechanism is wanted.

## Decision

Make the failure loud, durable and visible. Do not raise the ceiling.

- **Nothing escapes `onSave`.** The encoded size is checked against `SNAPSHOT_MAX_BYTES`
  (1,900,000 — 5% under the documented cap, because SQLite row overhead is uncharacterised)
  _before_ the write, and the write itself is wrapped. The library's swallow becomes unreachable.
- **A snapshot over the threshold is not written at all**, rather than attempted and lost. The
  last good snapshot stays intact.
- **A `ydoc_health` row records the failure**, written only on a state transition, with three
  states: `ok`, `degraded` (we cannot save right now) and `stale` (the snapshot you are reading is
  known-incomplete). `planLoad` maps a stored failure to `stale` on every wake, and `stale` is
  cleared only by a successful save. This is what survives hibernation: without it a woken room
  reloads a known-incomplete snapshot, has no memory of why, and reports perfect health forever —
  while the first client holding a fuller copy helpfully re-uploads it and masks the bug.
- **A versioned notice is pushed to clients** over y-partyserver's `__YPS:` custom-message
  channel, on transition only, and **again from an `onConnect` override**.
  `broadcastCustomMessage` reaches only sockets open at the instant it fires, so without the
  `onConnect` push a reload — or a visitor arriving after the room has hibernated and been
  evicted, which on the realistic discovery path is _every_ visitor — would see a healthy UI. The
  channel carries a closed enum, never display text; all copy is client-side and keyed by state.
- **`callbackOptions` becomes `{ debounceWait: 2000, debounceMaxWait: 5000 }`.** 2000 is
  y-partyserver's own default trailing value, so only the 10 s ceiling is tightened. This caps the
  bursty worst case at ~43,200 writes/day and floors the continuous case at ~17,280.
- **Four transition-only log lines**, all prefixed `relay.persistence`, with the room identified
  by the first 8 characters of its name only. The room name _is_ the share capability, so writing
  all 33 characters into a log store would copy that capability into it; 8 characters distinguish
  rooms and leave ~96 bits unguessable. The `event=warn` line at 75% of budget is the only one
  that can arrive before loss; the rest are post-mortems.
- **Everything decidable is pure.** `persistence-plan.ts` is a reducer over
  `(bytes, size, state, warned, now)`, so the Durable Object — which a Node test runner cannot
  import, because it transitively pulls `cloudflare:` modules — stays a thin adapter short enough
  to verify by reading.

## Consequences

- **The ceiling does not move by one byte.** A workspace stops being saved at roughly 3,000–6,000
  never-edited issues, and the threshold here stops 5% earlier still. This makes the boundary
  visible and predictable; it does not push it out.
- **It informs, it does not rescue.** A user who dismisses the banner and keeps working still
  loses everything since the last good save on eviction — just not in silence.
- **The only way back under the ceiling is deleting issues.** gc is already on and reclaims ~95%
  of deleted content, and that is the whole recovery story. A V1 document does not shrink
  otherwise, so a degraded room will essentially never recover on its own.
- **The loss window widens from 2 s to 5 s.** This is a deliberate reversal of the reasoning in
  the old `callbackOptions` comment, which argued the library default was "a long time to hold the
  only copy of a change in evictable memory". That reasoning was not wrong, it was incomplete: it
  priced the ceiling and ignored the trailing timer, and the write budget it spent is the same one
  whose exhaustion causes the silent failure this ADR exists to report. It is safe because every
  client holds the whole document in IndexedDB and re-syncs; it is genuinely exposed only when the
  last client holding those changes disconnects inside the window and never returns.
- **The rows-per-day route is served worst, deliberately.** If the account's budget is exhausted
  the health-row write throws too, so an eviction inside an exhausted day loses the marker and the
  room's next life reports healthy. Accepted because the blob route is permanent while the budget
  route resets at 00:00 UTC — the permanent failure is the one worth persisting. The in-memory
  flag and the broadcast still work for as long as that room instance lives.
- **`reason: 'unknown'` is a real outcome with vague copy.** The error shape for budget exhaustion
  is undocumented and may be indistinguishable from any other SQL failure by anything but text.
  `classifyWriteError` matches a message substring, which is a brittle contract on undocumented
  behaviour — decoration only, because the size pre-check is what actually classifies, and
  anything unrecognised lands on `'unknown'` by construction rather than by guess.
- **`event=warn` re-fires once per hibernation wake**, not once per excursion, because the latch
  lives in memory. Bounded and accepted: a room edited every 30 s costs ~2,880 lines/day against a
  200,000/day budget, and persisting the latch would spend a row write to save a log line.
- **The degraded room re-encodes the whole document every save cycle** purely to learn it still
  cannot be saved. CPU on a free-plan object, no rows, accepted in exchange for noticing recovery
  immediately.
- **One wire format is written twice**, in `workers/relay/src/storage.ts` and
  `src/lib/sync/relay-notice.ts`, because the relay's tsconfig is standalone by design and the app
  bundle must not pull in the relay package. Paired tests asserting the same literal string are
  the only guard — the same drift risk the repo already accepts for `RELAY_PARTY` and `ROOM_NAME`.
- **While degraded, the status trigger shows a warning triangle instead of its connection icon**,
  so connected-versus-offline is readable only from the popover. Deliberate: "connected but not
  saving" is the worse fact, and a cloud icon asserting otherwise is an active lie.
- **No telemetry.** The owner learns about a wedged room by opening the demo, or by reading
  `wrangler tail` within three days. Right for a portfolio demo, wrong for a product.
- `CREATE TABLE IF NOT EXISTS` now runs twice per wake instead of once. Whether a no-op DDL
  statement is billed as a row written is not documented; the pre-existing snapshot table already
  established the pattern, so this is at worst the same order of cost rather than a new class of
  it.

## Alternatives considered

- **Chunk the snapshot across rows** (2 MB is per _value_, and rows per table are unlimited). The
  best of the rejected mechanisms, and two objections to it are wrong and should not be recorded as
  if they held: atomicity is genuinely settled, because `ctx.storage.transactionSync` is documented
  to roll back on a throw; and "chunking multiplies the daily row burn" is false below the chunk
  size, where a save is still exactly one `INSERT OR REPLACE`. It loses for different reasons. It
  trades a **diagnosable, permanent, predictable** failure — a byte count, knowable before the
  write — for an **undiagnosable, intermittent** one in rows-per-day exhaustion, whose error shape
  is unverified and which is account-wide. It buys headroom this project has no use for: the next
  wall after the blob cap is the Durable Object's heap and the CPU of encoding on every save, and
  chunking guards neither. And it adds a new silent-truncation class, a chunk set that reassembles
  into a prefix.
- **Switch the stored encoding to `encodeStateAsUpdateV2`.** Measured at 0.726–0.941 of V1 on the
  route that actually kills rooms, and marginally _worse_ on create/delete churn; it wins only on
  pure field-edit churn, which needs ~90,000 deliberate edits. +13–37% headroom is one more
  afternoon. The decisive finding is a trap: **`Y.applyUpdate` on a V2 payload does not throw.** It
  returns silently, leaving an empty document, so `decodeSnapshot`'s `try/catch` never fires and
  never logs. A marker-less switch is this exact silent-loss bug, reintroduced by its own fix. (The
  reverse direction does throw.) A switch would need a stored format discriminator, which is a
  schema change bought for a 13% gain.
- **A `format` column written as `1` now, as a free V2 hedge.** Declined although it is cheap:
  with nothing deployed there is nothing to migrate, so the option costs nothing to create later,
  and the column would be an unused field in a schema where every column currently has a reason.
- **Compaction.** Measured: applying a churned update into a fresh `Y.Doc` and re-encoding gives a
  byte-identical result. History sheds only by rebuilding from read _values_, which mints new
  client IDs — so every connected replica's state vector references items the compacted document
  lacks, sync step 1 makes each client re-send its history, and the merge resurrects exactly what
  was discarded. Each client's `y-indexeddb` store means a visitor returning next week does it
  again. There is no cheap version, and a CRDT has no undo.
- **An append-only delta log.** Structurally the best long-term answer: one row per save regardless
  of document size, and a merge-based rebase that preserves client IDs. It needs load-path
  ordering, a rebase trigger policy, a chunking answer for a base that itself passes 2 MB, and a
  correct mid-rebase failure path. Several times the risk, for a benefit the one-line debounce
  change already delivers on the axis that matters. If the demo ever runs hot, build this — on top
  of the honest-failure path, not instead of it.
- **Refusing writes, closing sockets, or a read-only room at the ceiling.** Incoherent in a CRDT
  relay: the client has already applied and locally persisted the update before it arrives, and
  refusing would close the one recovery path that exists, which is a client holding newer state
  reconnecting and re-uploading it.
- **A persistence watchdog or synthetic round trip.** [ADR 0007](0007-presence-liveness-is-owned-by-the-client.md)
  and [ADR 0008](0008-connection-liveness-nudge-not-reconnect.md) already settled that this stack
  does not manufacture traffic on a timer of its own making. A server-pushed notice gives the same
  information at zero idle cost.
- **Paid alerting, email, webhooks or an external uptime check.** Free plan, and the premise is
  that nobody is watching. A channel the owner will also not watch is motion, not progress.
- **Per-save logging.** Free plan allows 200,000 log events/day with three days of retention. At
  17,280–43,200 saves/day, one line per save is a large fraction of the budget for no information
  — and the three-day retention is exactly why the durable record of a failure has to live in the
  room's own SQLite rather than in a log line.
- **Clamping `store.seed(n)`.** `seed(10000)` produces a 3,282,493-byte snapshot, 1.64× the cap,
  so its first `onSave` can never succeed. But `seed(n)` has no non-test callers — the Phase 12
  demo button is `seedDemo()`, 14 issues, 5,988 bytes — so it is a console-only benchmark path.
  It earns a line in `AGENTS.md`, not a guard in the store.
- **A JSON or CSV export**, as the answer to "get my data out of a room that cannot be saved".
  There is none today. It is the right long-term answer and a real product feature with its own UI,
  keyboard entry and tests. The copy here is honest without it, because the data is still in the
  user's own IndexedDB.
