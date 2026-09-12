# 0008 — Connection liveness: nudge the socket, never call disconnect()

**Status:** Accepted
**Date:** 2026-09-13

## Context

Phase 11's acceptance criterion is that airplane-mode edits merge cleanly on reconnect. The
document already guarantees this — Yjs's sync-step exchange resends whatever the client's
current state vector says is missing, regardless of what changed while it was disconnected,
so nothing about merging needed fixing. What needed fixing was noticing a dead connection at
all: `y-partyserver@2.2.0`'s client provider writes `wsLastMessageReceived` on every inbound
message (`dist/provider/index.js:108,149`) and never reads it back anywhere in the package —
confirmed by grepping the whole installed file. A socket that goes quiet without closing
(the common shape of a real network problem — wifi drops, a NAT mapping expires, a captive
portal appears) is therefore reported as connected and synced forever.

The first design for fixing this proposed "forcing a reconnect" with `provider.disconnect()`
immediately followed by `provider.connect()`. That recipe is broken two different ways, both
confirmed against the installed package with throwaway probes rather than assumed:

**It does not reconnect anything.** `connect()`'s only guard is `!this.wsconnected && this.ws
=== null`. Both fields are cleared exclusively inside the WebSocket's own asynchronous
`close` event handler (`index.js:116-134`) — `disconnect()` itself does not touch them. A
`connect()` called in the same turn as `disconnect()`, awaited or not, finds its guard still
failing and is a no-op; whatever reconnection eventually happens is the pre-existing
backoff `setTimeout` already living inside the close handler, which would have fired on its
own regardless of anything this module did.

**It permanently kills BroadcastChannel.** `disconnect()` calls `disconnectBc()`
unconditionally. Resubscription only happens inside `connect()`'s own guarded branch
(`index.js:400-406`), which — per the point above — the broken recipe never actually reaches.
A "watchdog" built this way would disable local multi-tab sync the first time it fired, and
silently: nothing about the websocket eventually reconnecting on its own gives any sign that
BroadcastChannel did not come back with it.

## Decision

Never call `disconnect()` as part of recovering a suspect connection. Instead, `nudge()`
(`sync/connection.svelte.ts`) does one of two things depending on what is actually true of
the provider:

- If a socket is open (possibly half-open), close it. This routes through the library's own
  `close` handler — the same cleanup and the same backoff-driven reconnect an ordinary drop
  already goes through, BroadcastChannel resubscription included, because that handler's own
  reconnect path is the one that was never broken.
- If there is genuinely nothing to close (`ws === null && !wsconnected`), the provider is
  sitting in the gap between backoff attempts — exactly `connect()`'s own guard — so calling
  it here, with nothing unsafe preceding it, jumps the remaining wait instead of idling it
  out.

This is wired to exactly two triggers, both certain or nearly free, deliberately not a
periodic watchdog:

- **`window`'s `online`/`offline` events.** `offline` reports the certain, undebounced
  signal and nudges; `online` nudges after a small random delay (0–250ms) so several tabs
  woken by the same event don't all reconnect in the same instant.
- **`visibilitychange` to visible, gated on peer presence.** While other peers are known,
  their own [ADR 0007](0007-presence-liveness-is-owned-by-the-client.md) heartbeat keeps
  `wsLastMessageReceived` advancing every ~10s for free — so on becoming visible again,
  staleness past 20s (tighter than Presence's own 25s peer-staleness bound, so this fixes
  the connection before Presence would otherwise have to hide a peer who is actually still
  there) is a real signal, not an idle tab's ordinary silence. A solo tab is never checked
  this way: there is no heartbeat to have gone stale, and gating on the raw awareness map
  size (not the filtered peer list) mirrors ADR 0007's own reasoning exactly.

The raw provider events are additionally smoothed by `ConnectionStatus` before reaching the
UI: a transition _into_ 'offline' waits 1.2s, in case the very next retry (a real outage
retries on a capped exponential backoff, repeating every 2.5s) succeeds first. Every other
transition — recovery, or the certain `online`/`offline` signal above — applies at once,
because delaying good news serves nobody and a fact the user's own OS already agrees with
should never wait behind a timer meant for an uncertain one.

## Consequences

- **A socket that goes quiet without closing is now detected**, within the bound of whichever
  trigger fires first — immediately for airplane mode, within ~20s of the tab regaining focus
  if peers are present. A network-path failure that neither flips `navigator.onLine` nor
  happens to coincide with a visibility change is not caught by anything here: it still
  self-corrects once the browser's own TCP timeout elapses. That gap is real and left
  unclosed on purpose — closing it would mean either a periodic watchdog (steady-state
  traffic ADR 0002 and ADR 0007 both exist to avoid) or manufacturing round-trip messages to
  verify a solo tab, which has no honest mechanism: there is no per-update delivery
  acknowledgement anywhere in this protocol. The cost of leaving it open is a stale badge,
  never data — the document is local-first regardless of what the badge says.
- **BroadcastChannel is never at risk from this module.** `nudge()` does not call
  `disconnect()`, so multi-tab convergence (confirmed working since Phase 9's provider
  choice, independent of y-indexeddb which has none of its own) cannot be silently disabled
  by a liveness check.
- **The connecting/offline flap a real outage produces — five transitions in the first 5.5s,
  then one every 2.5s — never reaches the UI.** `ConnectionStatus` is transport-free and
  tested with a synthetic event sequence, the same way `Presence` is tested against a bare
  `Awareness` rather than a real relay.
- **The status control distinguishes four states, not three**: `'local'` (no relay
  configured — nothing is wrong) is now distinct from `'offline'` (configured, unreachable).
  Getting this to actually render required `attachRelay`'s no-relay branch to call
  `onConnection('local')` explicitly; the type system does not catch a value that is simply
  never produced.
- **The status control's two sentences are independently true.** "Saved on this device" is
  conditioned on `store.persisted` (Phase 10 already tracks IndexedDB failure; nothing had
  wired it in yet) rather than assumed, and "who else has it" is exhaustive over connection
  state × peer count, including the case a naive `Shared with N others` template would
  render as nonsense (connected, synced, and genuinely alone).

## Alternatives considered

- **`disconnect()` then `connect()`** — the original design. Rejected: proven, with a probe
  against the installed package, to be both a no-op for reconnection and a silent,
  permanent regression for BroadcastChannel.
- **A periodic watchdog independent of visibility** — would catch the network-partition gap
  above, at the cost of a timer that runs (and could re-wake a hibernating relay) whether or
  not anything is actually wrong. Rejected on the same cost grounds ADR 0007 already
  established for presence.
- **Verifying a solo tab's connection by echoing its own edits** — the one signal the relay
  happens to provide (it broadcasts document updates to every connection, sender included)
  is undocumented incidental behavior, not a designed acknowledgement, and manufacturing
  reliance on it was judged too fragile. A solo tab's connection is simply not verified
  between the two triggers above; see Consequences for the resulting gap.
