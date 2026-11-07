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

**Guarded (2026-10-22).** The capacity figures above were measured once and asserted nowhere, so
one added field on the issue model could have moved the real ceiling by thousands of issues
while this ADR went on quoting the old number — and the first sign would have been a demo
workspace that quietly stopped persisting. `src/lib/sync/snapshot-capacity.test.ts` now measures
it: 307.6 bytes per generated issue, 4,000 issues below even the warning threshold, 8,000 above
the refusal one, and the crossover inside the range stated here. It reads
`SNAPSHOT_MAX_BYTES` out of the relay's source as text rather than importing it (which would
pull workerd's types into the app's program) or copying it, so retuning or renaming the
threshold fails the test rather than silently invalidating this paragraph. One field added or
removed moves the per-issue figure by about 22 bytes, which is what the band is sized to catch.

A **second route to the same silent failure** surfaced while measuring: the free plan's
100,000 rows-written-per-day budget is account-wide, and exceeding it makes "further operations of
that type fail with an error" — the same throw, into the same swallow. The old
`callbackOptions = { debounceWait: 300, debounceMaxWait: 2000 }` made this worse than it looks,
because the **trailing** timer is the worst case: any gap longer than `debounceWait` fires a save,
so bursty human typing costs more than continuous editing. At 300 ms that is up to ~288,000 row
writes a day from one room, i.e. one room could exhaust the whole account in about 8.3 hours.

~~Nothing is deployed yet — CI only runs `wrangler deploy --dry-run` for both workers — so there are
no stored snapshots to stay compatible with.~~ That freedom is used below for a new table, with no
legacy-read branch. It is not, however, an argument for a larger mechanism: being free to change
the schema says something about cost, not about whether a mechanism is wanted.

**Expired, not wrong (2026-10-22, first real deploy).** Both workers are now live. The struck
sentence is left in place because it is the premise the next one rests on, and that premise held
at the only moment it had to: this ADR shipped _before_ the first deploy, so the schema it
describes is the first one any Durable Object ever wrote, and the absent legacy-read branch has
nothing to read. The sentence is now a statement about the past rather than the present — which
also means this freedom is spent. Any future change to the `ydoc_health` table or the snapshot
key faces stored data and needs a migration path.

**A row nobody can read (2026-11-02).** This ADR priced what a save that fails costs. It missed
what a save that _succeeds_ can cost. `decodeSnapshot` caught a throw from `Y.applyUpdate` and
returned an empty document, which `onLoad` handed to the room as if nothing had been stored, and
the room's next save overwrote `id=1` with it. So one damaged row destroyed the stored workspace,
with no log line and no notice. A save could also write exactly such a row. A 227-byte update,
found by byte-mutating ordinary updates and reducing, applies to a live document, encodes, and
leaves bytes that throw on reload (`workers/relay/src/unreloadable.fixture.ts`). Run through the
real relay, the row was replaced and a restart brought back an empty room. Anyone with the link
could do that to a workspace. And `onSave` left its encode outside any catch, on the reasoning that
a throw there was a bug in this worker. A document's state is a peer's to write, so that reasoning
was wrong, and the swallow above was still reachable.

## Decision

Make the failure loud, durable and visible. Do not raise the ceiling.

- **Nothing escapes `onSave`.** The encoded size is checked against `SNAPSHOT_MAX_BYTES`
  (1,900,000 — 5% under the documented cap, because SQLite row overhead is uncharacterised)
  _before_ the write, and the write itself is wrapped. So is the encode, along with everything else
  in the method (2026-11-02). The library's swallow becomes unreachable.
- **What a save writes has been reloaded first** (2026-11-02). `prepareSnapshot` applies the encoded
  bytes to a fresh `Y.Doc` before the write, at every size below the ceiling. If that throws nothing
  is written, the last good row stays, and the room goes `degraded` on the channels below. No size
  cut-off and no sampling, because either one lets through the row this exists to stop.
- **A damaged row is moved, not replaced** (2026-11-02). `decodeSnapshot` now reports `fresh` (no row,
  or no bytes), `good`, or `damaged` (non-empty and it throws on decoding or re-encoding, or a value
  of another type). `onLoad` cannot throw, because a room that cannot start cannot be recovered, so
  for a damaged row it moves the stored value into the single-row `ydoc_quarantine` table, deletes
  `id=1` and writes the health row, all in one `transactionSync`. Then it starts empty, and honest
  clients re-seed it from IndexedDB on connect, which is the recovery route that already existed.
- **The quarantine keeps the first copy** (2026-11-02). Its write is a plain `INSERT`, so nothing can
  overwrite it. If it is already taken, or the write fails, the later row stays in `id=1` and this
  instance refuses every save, so that row is not lost either. The next wake tries again.
- **A snapshot over the threshold is not written at all**, rather than attempted and lost. The
  last good snapshot stays intact.
- **A `ydoc_health` row records the failure**, written only on a state transition, with three
  states: `ok`, `degraded` (we cannot save right now) and `stale` (the snapshot you are reading is
  known-incomplete). `planLoad` maps a stored failure to `stale` on every wake, and `stale` is
  cleared only by a successful save. The exception is a failure stored with the reason `unreadable`,
  which comes back as a silent `degraded` (see the consequences below). This is what survives
  hibernation: without it a woken room
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
- **A refused save and a damaged row reuse `degraded` and `unknown`, and the wire does not change.**
  A new reason would change nothing a reader sees: `parsePersistenceNotice` drops a reason it does
  not recognise and keeps the state, the `degraded` copy treats anything but `too-big` as `unknown`,
  and the `stale` copy ignores the reason altogether. An old client would therefore say the same
  thing as the current one. Saying more would take a new sentence in the client. `degraded` and
  `unknown` read "The relay's last save failed, so it isn't storing this workspace right now. Your
  work is still saved in this browser." That is true of a refused save and of the wake after one. It
  used to end "Retrying automatically", which a room with its quarantine taken cannot honour: every
  wake reads the table, finds it occupied and refuses again, until an operator clears it. A client
  cannot tell that room from a failure that does clear, so the copy promises neither, and a reader
  of a passing failure gives up the reassurance. On a damaged wake "last save failed" is loose, since
  it is the stored copy that failed, but the part a reader acts on is true, and after an ordinary
  quarantine the next good save does repair it. `stale` would be false in both cases: it says the
  relay ran out of room, and that what you see is the last copy it kept, while a damaged wake has kept nothing it can show. So the health row stores
  `unreadable`, which never goes on the wire, and `planLoad` turns it back into `degraded`.
- **A damaged wake announces once.** The move can only happen once. A row that could not be moved
  latches on the health row instead, stays silent on later wakes, and reuses the stored `at`, so a
  dismissed banner stays dismissed. If the health row cannot be written either, nothing can hold
  that latch and the room announces on every wake. That is bounded by the wakes, and it is an accurate
  report of a room that can write nothing. Unlike a stale wake this one broadcasts as well, because
  sockets survive a hibernation and `onConnect` only runs for new ones. The new log lines are
  `event=quarantined`, `event=quarantine-failed`, `event=quarantine-write-error` and
  `event=quarantine-table-failed`, using the same 8-character room tag, and a refused save logs `event=degraded reason=unreadable`. For a room with
  its quarantine taken, the one `event=quarantine-failed` line is the only thing an operator is ever
  sent, and it is retained for three days. After that the room stays refused without a word, and only
  `ydoc_health` and the two tables show why.
- **A refused room stays degraded until its memory goes.** The poisoned document stays in memory
  after a refused save, every later save is refused too, and only an eviction clears it. After that
  the room reloads the last good row and the next save that passes clears the state. Any client
  holding the update can re-send it from IndexedDB and start this over, and so can whoever sent it,
  for as long as they hold the link, so a room can stay degraded until someone intervenes. This
  protects the data and does not repair the room. Measured with the fixture, honest clients did not
  hold the poison: the room never broadcasts structs it could not integrate, a late joiner's apply
  throws before integrating them, and a client reconnecting to the restarted relay took the room back
  to `ok`. Another poisonous update may behave differently, so do not read that as a guarantee.
- **A damaged wake can lose what only the relay held.** Clients re-seed what they have. Work that
  only ever reached the relay's row, from a client that has since cleared its storage, stays in
  quarantine until someone recovers it by hand, and a good save will report the room `ok` without it.
- **Recovery does not spend the evidence.** A good save clears the state and leaves the quarantine
  row, so an `ok` room can still hold one.
- **The next wall has not moved, but a save now does about a wake's work again.** Local workerd, the
  shape `createIssue` writes, first run then median of 9, whole milliseconds, one run of each:

  | issues | structs | snapshot | encode (was the whole save) | reload (added) |
  | ------ | ------- | -------- | --------------------------- | -------------- |
  | 500    | 5,000   | 120 KB   | 3 / 1                       | 4 / 1          |
  | 2,000  | 20,000  | 487 KB   | 6 / 3                       | 11 / 5         |
  | 3,000  | 30,000  | 739 KB   | 5 / 4                       | 26 / 10        |
  | 10,000 | 100,000 | 2.50 MB  | 17 / 13                     | 76 / 54 if run |

  Node's medians agree: 1.5, 5.4, 10.0 and 39.9 ms. The reload is the cost `WAKE_WARN_STRUCTS`
  describes, 0.2–0.9 microseconds per struct here against the 0.465–0.665 measured there, and it
  now runs on every debounced save. At 10,000 issues it does not run, because that snapshot is over
  the ceiling and is not going to be written. Under the 30-second reading of the unresolved limit
  this is nothing. Under the 10 ms reading, a save alone now passes 10 ms at around 2,000 issues,
  where encoding alone did not at 3,000. The first failure does not move, because a wake already
  does more than this (two applies and two encodes: about 28 ms warm at 3,000 against 14 for the
  save), so a room that can wake can save. But it runs on every save, it is not free, and the
  check to run against a deployed account is the same one. The reloaded copy also adds about 15 MB
  of heap at 3,000 issues until the next collection.

- **The reloaded state vector is not compared with the live one.** It would have stopped honest rooms
  saving. In an honest fuzz (random edits, deletes, undo and redo, gc on and off on each side,
  shuffled, duplicated, held-back and merged delivery, sync-step-2 diffs, rebuilds from the room's
  own snapshot), the two differed on 101 of 1,117,089 saves, always with the reload ahead:
  it integrated structs the live document still held pending. No reload threw on honest data. Checking
  only that a reload is not behind the live document had no false positives, and also found nothing
  in 1,050,000 byte-mutated hostile updates, of which 32,866 left bytes that throw on reload, so it
  would add a risk and buy nothing.
- **One hop is still unguarded.** y-partyserver encodes the document `onLoad` returns and applies it
  to the room's own, outside any catch of ours, so that is a second load. Of the 1,017,134 states in
  that hostile fuzz whose first load passed, none failed the second. Most of those updates had been
  refused part-way when they arrived, so about 147,000 applied cleanly, and that is evidence rather
  than proof. Re-encoding is part of `decodeSnapshot` because of it, and it is a place to look if a
  room ever stops starting.
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
- **There may be a tighter ceiling than this one, on a different axis, and it is now reported.**
  Waking a hibernated room re-applies the whole snapshot, and that cost tracks the number of Yjs
  **structs**, not the byte count — measured at 0.465–0.665 microseconds per struct across every
  shape tried, in Node and inside real workerd, which puts ten structs (a sub-map plus nine
  fields) on every issue. The byte guard above is therefore blind to it in both directions, and
  the examples are not hypothetical: 3,000 empty-description issues is 880 KB, under the byte
  warn, and ~14–18 ms to wake; 500 live issues plus 20,000 churned structs is 512 KB and ~12 ms;
  while 1,315 long-description issues is 1.96 MB, over the byte ceiling, and only ~6–9 ms.
  Whether that matters depends on a limit **Cloudflare does not document**. The Durable Objects
  limits page gives "CPU per request | 30 seconds (default)" with no plan split, and its footnotes
  describe the 30 seconds unconditionally; its own FAQ says Durable Objects have "the same per
  invocation CPU limits as any Workers do" and links to a table reading "CPU time | 10 ms" for
  Workers Free. Two independent passes over the Workers limits, Durable Objects limits, Workers
  pricing, Wrangler configuration and both changelogs found no page stating a free-plan Durable
  Object CPU figure, and no changelog entry ever raising the 10 ms Workers Free value. It is also
  not testable locally: Wrangler documents that limits "are only enforced when deployed to
  Cloudflare's network, not in local development", so real workerd under `wrangler dev` will not
  reproduce it either. **It is answerable only against a deployed account** — seed ~4,000 issues,
  let the room hibernate, reconnect — and that is the check to run once credentials exist.
  So this ADR does not design around either reading. It emits one log line,
  `event=wake-cost`, when a document passes `WAKE_WARN_STRUCTS` (20,000 structs, about 2,000
  issues, roughly where the pessimistic limit would be crossed), latched for the life of the room
  because structs never decrease. Under the 30-second reading that line is noise. Under the 10 ms
  reading it is the only warning available, because this failure has no graceful degradation: the
  byte ceiling still lets a room relay in memory, whereas a room that cannot finish `onLoad`
  cannot serve at all. A cap was rejected for the same reason the ceiling is not raised — capping
  a demo at a quarter of its measured capacity, for a limit that may not exist, is the worse
  error.
- **No telemetry.** The owner learns about a wedged room by opening the demo, or by reading
  `wrangler tail` within three days. Right for a portfolio demo, wrong for a product.
- `CREATE TABLE IF NOT EXISTS` now runs three times per wake instead of once. Whether a no-op DDL
  statement is billed as a row written is not documented; the pre-existing snapshot table already
  established the pattern, so this is at worst the same order of cost rather than a new class of
  it. For a room that was already deployed, the third is a real schema write once, on its first wake
  after the table was added, and whether an exhausted budget refuses DDL is not documented either.
  So that one may fail: `onLoad` logs `event=quarantine-table-failed` on each wake it fails, a healthy
  room starts without the table, and a damaged row stays where it is with saves refused until a wake
  can create it. The first two are not guarded, so a brand-new room inside an exhausted budget may
  still fail to start.

## Expiry and a lower ceiling (2026-11-07)

Nothing deleted a room, ever, and nothing could pick out the ones nobody used, because room names
cannot be listed. So the account's 5 GB of Durable Object storage, which does not reset like the
daily budgets, could be filled by anyone minting rooms and saving a large snapshot into each, and
then writes would fail for every room until the owner wiped them all.

- **Every room expires 30 days after it was last opened or saved into, unless someone is
  connected when its alarm fires** (`workers/relay/src/expiry.ts`). A wake and a save both move
  the alarm, but only when it has fallen more than an hour behind, so typing costs no extra
  writes. A connected room puts the alarm off for another term.
- **Rooms from before 2026-11-07 get an alarm only on their next wake.** One nobody opens again
  keeps its storage until an operator wakes it: list the namespace's objects through Cloudflare's
  API and connect to each, which arms its alarm.
- **Expiry takes everything**: the snapshot, the health row and any quarantined row. This changes
  what "stays in quarantine until someone recovers it by hand" above means: by hand, within 30
  days of the room's last save. A room nobody has saved into for that long has nobody to report
  it to.
- **The cost is a newcomer's copy.** A workspace whose people are all away for 30 days opens empty
  for someone who only has the link. Anyone who has opened it in their browser still holds the
  whole document in IndexedDB and uploads it again when they next connect.
- **The ceiling is now 1 MB** (`SNAPSHOT_MAX_BYTES`), half the row cap, with the warning at
  750 KB. The table above is still the row cap's; at 1 MB a never-edited workspace holds about
  3,250 issues (`snapshot-capacity.test.ts` asserts 2,900-3,600), far past any demo workspace,
  and each room a stranger fills costs half as much.
- **An expired room that someone reaches before eviction keeps going.** `deleteAll` empties
  storage but not the instance's memory, so a connection in that window still gets the document.
  `onConnect` saves at once, which recreates the tables, arms a new term and writes the document
  back, because a returning tab that holds nothing new would otherwise never trigger a save.
- **Rooms already between 1 MB and 1.9 MB** stop being saved on their first save after the lower
  ceiling, and say so through the existing over-the-ceiling notice.

## Recovering a quarantined row

An operator has to do this; nothing in the app reads the table. A `relay.persistence
event=quarantined` or `event=quarantine-failed` line in `wrangler tail` or Workers Logs names the
room by its first 8 characters, retained for three days on the free plan. The table itself is the
durable record, and it stays until someone clears it.

1. **Open the room's storage.** You need the full room name, which is the `?ws=` value in the
   workspace's link, because 8 characters cannot address an object. In the Cloudflare dashboard open
   the `YDocRoom` namespace, then **Data Studio**, and give it that name. It needs at least Editor
   access to the Worker, its queries are recorded in the audit log and billed as usage, and they run
   against the live object. Locally, the file is under the persist directory at
   `v3/do/<script>-YDocRoom/`, and is plain SQLite once `wrangler dev` has stopped.
2. **Copy the bytes out before changing anything:** `SELECT hex(doc), at, error FROM ydoc_quarantine`.
   A room reporting `reason=occupied` also holds a later row, which has to be saved the same way:
   `SELECT hex(doc) FROM ydoc_snapshot`.
3. **Salvage what landed.** Apply the bytes to a fresh `Y.Doc` in a `try`, with this repo's patched
   Yjs. Everything integrated before the throw stays in the document, which is why the relay will
   not start from one, and is why this works here: `Y.encodeStateAsUpdate` on that document gives
   bytes that do load. With the fixture it recovered all three entries, the real work included.
   `Y.decodeUpdate` lists every struct if you need to see what did not land. A row that stopped
   loading after a Yjs bump may load whole under the old version.
4. **If the table is what is refusing saves, make room first.** That is a room that logged
   `reason=occupied`, or whose `ydoc_health` says `degraded` and `unreadable` with a row in both
   tables and a `ydoc_snapshot` that fails step 3. Skip this step for any other room. This instance
   refuses every save for as long as it lives, and says nothing about it, so step 5 would store
   nothing and step 6 would then delete the first copy with no salvage on the relay. So with both
   of step 2's dumps safe, run `DELETE FROM ydoc_quarantine WHERE id = 1` and let the instance go,
   by leaving the room idle until it is evicted or by deploying the relay. The next connection
   wakes it, moves the later row into the table and starts the room empty. Before going on, check
   that `ydoc_quarantine` holds the later row and `ydoc_snapshot` is empty. If not, the old instance
   is still there. The first copy now exists only in your dump, so step 5 puts back what you
   salvaged from both.
5. **Put it back as a client.** Connect a plain Yjs provider to the room and apply the salvaged
   update, as `e2e/relay-damage.e2e.ts` does. The relay merges it, verifies it and saves it, so a
   mistake here is refused and not stored. Do not write it into `ydoc_snapshot` by hand.
6. **Clear the quarantine last,** once `ydoc_health` says `ok` and `ydoc_snapshot` holds the work:
   `DELETE FROM ydoc_quarantine WHERE id = 1`.

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
- **Leaving a damaged row in `id=1` until a save replaces it**, with the quarantine as a copy. One
  row write fewer, but every wake before that save finds it again, so telling a new failure from
  an old one would need a byte comparison against the quarantine.
- **Overwriting the quarantine with the later damaged row.** The later row is not obviously worth
  more: the first was probably the workspace as last saved, and later ones are what came after a
  re-seed. **Dropping the later one**, which is what a single-row table implies, would lose a row
  to keep a table tidy. Refusing saves costs a room that does not persist until someone comes, and
  it takes a second independent corruption to get there, because a hostile save can no longer
  write one.
- **Applying the row straight to the room's document in `onLoad`**, which would remove the unguarded
  hop above and save a wake an encode. Not needed by anything found, and the fix should
  not move how every healthy room loads.
- **A new wire reason, with its own sentence in the client.** The honest long-term copy for a damaged
  wake, and three more files with nothing to act on that the existing sentence does not already say.
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
