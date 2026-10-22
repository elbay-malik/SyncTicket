# 0002 — Deploy target: Cloudflare Workers free plan, two-worker layout

**Status:** Accepted
**Date:** 2026-07-08

## Context

The budget is 0 €. Cloudflare's Workers free plan covers everything SyncTicket needs: 100k requests/day, static assets, and — decisively — SQLite-backed Durable Objects (GA on the free plan; 100k DO requests/day, 13k GB-s/day duration, hibernating WebSockets so idle rooms cost nothing).

Verified constraints that shape the layout (as of 2026-07-08):

- `@sveltejs/adapter-cloudflare` 7.2.9 (stable) targets Workers with static assets, but **cannot export Durable Object classes** from the SvelteKit worker — the adapter owns the entry module (sveltejs/kit issue #1712, open). Native support arrives only with kit PR #15627 / adapter 8.0.0-next, which requires the SvelteKit 3 prerelease and also removes Pages support.
- Wrangler requires DO migrations (`new_sqlite_classes` — the free plan is SQLite-DO-only) to live in the config of the worker that **defines** the class.
- A worker can bind to a DO defined in another worker via `durable_objects.bindings[].script_name`.
- `wrangler deploy --dry-run --outdir=…` compiles and validates the worker bundle with no credentials, so CI can prove deployability without an account.

## Decision

Target Cloudflare Workers (not Pages) via adapter-cloudflare 7.x with `wrangler.jsonc` at the repo root (`nodejs_compat`, ASSETS binding, `main: .svelte-kit/cloudflare/_worker.js`). Commit now to a **two-worker layout**: the SvelteKit app worker at the root, and the future Yjs relay as a separate Worker in `workers/relay/` that defines the DO class and its `new_sqlite_classes` migration. CI validates with `wrangler deploy --dry-run`; the first real deploy is deferred to Phase 12.

## Consequences

- The browser connects to the relay's own URL directly over WebSocket; the SvelteKit worker never proxies sync traffic (good: hibernation accounting stays in the relay; bad: two deploys to manage).
- `compatibility_date` is capped by the workerd bundled with the pinned wrangler (2026-07-06 for wrangler 4.107/4.108) — a later date hard-fails `wrangler dev`, which is also the Playwright e2e webServer. Bump it together with wrangler upgrades.
- Dry-run does not validate account-level concerns (workers.dev subdomain, name availability, quotas); expect small surprises at first real deploy.

  **Resolved (2026-10-22, first real deploy).** Both workers deployed to the free plan without a
  single bundle-level surprise: `syncticket-relay.eleo-666.workers.dev` (333.83 KiB, the `v1`
  `new_sqlite_classes` migration applied silently) and `syncticket.eleo-666.workers.dev`
  (1,579.82 KiB plus 42 static assets, the largest being the 23.5 MB ONNX runtime — under the
  25 MiB per-asset cap, with less headroom than is comfortable). The two surprises this
  consequence anticipated were both in the _tooling_, not the account: `wrangler login` printed
  `Timed out waiting for authorization code` while having already written valid credentials, so
  `whoami` is the check and the exit code is not; and because the relay config carries an `e2e`
  environment with no rate limiter, a bare `wrangler deploy` only **warns** that no target was
  named — so both relay deploy scripts now pass `--env=""`.

- Revisit the two-worker split if kit PR #15627 merges and adapter v8 stabilizes on SvelteKit 3.

## Alternatives considered

- **Same-worker DO via community shims** (e.g. sveltekit-add-worker-exports) — self-described as temporary pending #15627; too load-bearing a hack for the project's foundation.
- **Cloudflare Pages** — legacy target; adapter v8 drops it entirely.
- **Hetzner CX22 (~4 €/month)** — only needed for the ElectricSQL fallback path (ADR 0001); breaks the 0 € constraint.
