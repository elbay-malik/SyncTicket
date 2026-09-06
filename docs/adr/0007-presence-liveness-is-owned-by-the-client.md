# 0007 — Presence liveness is owned by the client, not the protocol

**Status:** Accepted
**Date:** 2026-09-06

## Context

Phase 10's acceptance criterion is that "disconnects clear presence within seconds". The obvious reading is that this comes free: `y-protocols` documents that "awareness states must be updated every 30 seconds, otherwise the Awareness instance will delete the client state", and y-partyserver's server clears a peer's state when its socket closes. Neither holds in the stack this project actually ships, and all three of the following were verified against the installed packages rather than the documentation.

**The 30-second sweep never runs.** `outdatedTimeout = 30000` is a module constant with no option, setter or subclass hook, but that is moot: the interval that consumes it is cleared at both ends. The client provider does it in its constructor, and the server does it in `WSSharedDoc`. A peer that vanishes without closing its socket — a closed laptop lid, a yanked cable — is therefore shown as present forever, not for thirty seconds.

**Hibernation empties the server's awareness map.** [ADR 0002](0002-deploy-target-cloudflare-workers-free-plan.md) makes an idle room free by hibernating its Durable Object, which evicts the instance's memory while its WebSockets survive. A disconnect arriving after a hibernation cycle asks `removeAwarenessStates` to remove a client the woken instance has never heard of, and it broadcasts nothing at all. The same wake also serves new joiners an empty room, because nothing makes the existing peers re-announce.

**An abrupt disconnect misses the cleanup entirely.** partyserver routes a dead socket to `onError`, which `YServer` does not implement; the base method only logs.

The remaining route — a clean close on a resident instance — does work, and works immediately. It is the happy path, and it is the only path the protocol covers.

## Decision

Own liveness in the client. `state/presence.svelte.ts` publishes a heartbeat every 10 seconds, hides any peer it has not heard from in 25 seconds, and forgets one entirely after 2 minutes. `YDocRoom.onError` is overridden to run the same cleanup `onClose` does.

The heartbeat is gated on whether any other client is known, so a tab on its own sends nothing at all and an idle room still hibernates. Crucially the gate is the raw awareness map rather than the visible peers: a peer that has been hidden but not yet forgotten still counts, so two clients that stop hearing each other keep beating and recover the moment one message gets through. Once the last peer is forgotten the traffic stops and the room goes back to costing nothing.

## Consequences

- **The unbounded case is now bounded.** A peer that vanishes silently disappears from everyone else's screen in about 25 seconds instead of never. A clean disconnect is still immediate, because the protocol's own removal still arrives first.
- **Hibernation is repaired rather than disabled.** Each beat re-populates a woken instance's awareness map, which re-arms its removal-on-disconnect and gives the next joiner someone to see.
- **An idle workspace still costs nothing**, which was the reason to hibernate at all. The cost of the beat is bounded: at most two minutes of one message per ten seconds after the last peer leaves.
- **Liveness runs on one clock.** Staleness is measured with timestamps this module stamps on arrival, not `awareness.meta.lastUpdated`. `lib0/time.js` captures `Date.now` by reference at module load, so that timestamp comes from a clock nothing else can substitute — which makes the behaviour untestable and, more importantly, unobservable. Stamping on arrival also means a peer with a wrong system clock cannot make itself look permanently fresh.
- **Stale peers are dropped locally and never with `removeAwarenessStates`**, which broadcasts. One client's bad connection must not evict a healthy peer from everyone else's screen.
- **Peers are keyed by a self-minted user id, not by Yjs client id**, so one person in three tabs is one avatar rather than three. The id authorises nothing; it only groups sessions.
- **Everything a peer says about itself is validated before rendering** — the same `parseIdentity` the local identity goes through. Awareness state is written by anyone holding the workspace link ([ADR 0004](0004-no-auth-workspace-id-demo-mode.md)), so a display name has its control and bidi characters stripped and its length capped, and an issue id is bounded before it is used as a map key.
- **A peer transmits a hue, not a colour.** The UI puts the number inside `oklch()` with a lightness the theme pins per mode. A colour _string_ interpolated into a style attribute would be a CSS injection with a working network beacon on the end of it, reporting who is looking at what.
- **The acceptance criterion is tested where it can be controlled.** An end-to-end test can only close a browser context, which produces a clean close or a socket error depending on timing, and can never produce the case that matters most. The silent-vanish and recovery paths are driven directly against two `Awareness` instances with a cuttable transport; the end-to-end tests cover two real browsers seeing and losing each other.
- **A local `wrangler dev` still cannot evict a Durable Object**, so the hibernation path is asserted at the unit level instead: `workers/relay/src/presence.test.ts` pins the fact that a woken instance's cleanup broadcasts nothing, which is the reason this ADR exists.

## Alternatives considered

- **Trust `outdatedTimeout`** — the documented behaviour, and what the phase brief originally assumed. Rejected because the interval it depends on is cleared on both ends; a test written against it can never pass.
- **Restore the protocol's sweep** by not clearing the interval on our own Awareness. Rejected because the provider clears it again on the instance it is handed, and re-enabling it would still leave the server side dead and the hibernation gap open.
- **Prune with `removeAwarenessStates` and let it broadcast**, which is how y-websocket's own sweep works. Rejected because it converts one client's bad connection into everyone's: a peer pruned by a client with packet loss is evicted from every screen.
- **Beat unconditionally**, which is much simpler. Rejected on cost: a ten-second beat from an idle tab wakes the Durable Object about 8,600 times a day and keeps a room resident that would otherwise be free.
- **Board cursors**, which the roadmap lists. Deferred deliberately, and for the same reason: a pointer trail is a continuous stream of updates, every one of which wakes a hibernating room, and it tells a tracker's users far less than knowing which issue someone has open.
