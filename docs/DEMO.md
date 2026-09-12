# The two-minute demo

Everything below is also a Playwright test (`e2e/demo.e2e.ts`), including the exact words
quoted here — if a screenshot of the popover ever stops matching this page, that test fails.

## Setup

```
pnpm demo
```

Starts the relay and the app together against `http://localhost:5173`. Open that URL in one
browser window.

## 1. A workspace of your own

The first visit mints a private workspace — nobody else can reach it without the link. The
connection badge in the header (a small cloud icon) reads, when you open it:

> Saved on this device. Local only — no relay configured.

Run `pnpm demo` rather than `pnpm dev` for the rest of this script: it sets
`PUBLIC_RELAY_HOST`, without which the app is intentionally local-only and every step below
that involves a second browser has nothing to show.

## 2. Share it

Click **Share** in the header to copy the link. Open that link in a second browser — a
different browser entirely, or a private window, so it doesn't inherit the first one's
`localStorage`. Presence propagates over the same already-open connection document sync
does, so by the time the second window has loaded, both sides already show:

> Saved on this device. Shared with 1 other.

Create an issue in either window — it appears in the other within a second.

## 3. Edit the same thing from both sides at once

Open the same issue in both windows and change its title in each, quickly, before either
side has seen the other's edit. Both windows converge to the _same_ title a moment later —
but not predictably to either one you typed. That's deliberate: Yjs resolves the conflict by
comparing a random id each browser mints for itself, not by which edit was typed first or
last. What the CRDT promises is that both sides end up identical, never that a particular
edit wins — if you run this step twice, don't be surprised to see the other browser's version
survive the second time.

## 4. Go offline

Turn off networking in one window (airplane mode, or disconnect wifi) — not merely wait, do
this from the OS or the browser's own network panel, since the app cannot simulate it for
you. The badge updates immediately, not after a delay:

> Not shared — you're offline.

Everything you do in this window keeps working — create an issue, edit another, delete one.
Nothing you do here reaches the other window yet.

## 5. Come back

Restore networking. The badge recovers on its own within a few seconds — no reload needed —
and every edit made while disconnected appears in the other window:

> Saved on this device. Shared with 1 other.

## What this demonstrates

- **The document is local-first, unconditionally.** Every edit in every step above lands
  immediately, whether or not anyone is listening. The relay is how two browsers find out
  about each other's edits, never a precondition for making one.
- **The status line never claims more than it can prove.** "Saved on this device" and
  "Shared with N others" are independent facts — a browser that can't reach the relay has
  still saved locally, and (see [ADR 0007](adr/0007-presence-liveness-is-owned-by-the-client.md))
  a browser that stops hearing from a peer says so within seconds rather than staying
  silent about it.
- **Conflicts resolve, they don't get flagged for a human to sort out.** There is no merge
  dialog anywhere in this app. Step 3 is what that looks like end to end: two people, one
  field, and the document repairs itself.
