# Deploying to Cloudflare

Both workers deploy on the free plan — no custom domain, no paid tier, no account
configuration beyond having a Cloudflare account at all. This is a runbook, not a script:
every command below is meant to be read and run by a person, once, the first time. It is not
something this repo's automation runs for you — `wrangler deploy` (unlike the `--dry-run`
CI already does on pushes to `main` and on pull requests) changes what a live URL serves, and needs a logged-in,
authorized account to do it.

## 0. One-time setup

```sh
pnpm install
pnpm exec wrangler login          # opens a browser; needs a Cloudflare account
pnpm fetch:search-assets          # vendors the embedding model + ONNX runtime (~46 MB,
                                   # gitignored — see ADR 0009). Skip this only if you plan
                                   # to never click "Add meaning search"; lexical search
                                   # works either way.
```

`wrangler whoami` confirms you're logged in, and is the **only** check worth trusting: on the
first real deploy, `login` printed

```
✘ [ERROR] Timed out waiting for authorization code, please try again.
```

and exited 1 while having already written valid credentials to
`~/Library/Preferences/.wrangler/config/default.toml`. It waits on a `localhost:8976` callback
and gives up before the browser consent is necessarily finished. So run `whoami` before
retrying — a retry after a _successful_ login is harmless, but believing the exit code sends you
hunting a problem you do not have. If `whoami` says "You are not authenticated", then `login`
really did not complete.

## 1. Deploy the relay first

The app's build needs to know the relay's URL, and the relay's URL only exists once it has
been deployed at least once — so it goes first.

```sh
cd workers/relay
pnpm run deploy
```

Run the **script**, not `wrangler deploy` directly. This config defines a second environment,
`e2e`, which deliberately has no rate limiter (the Playwright suite is a load generator and
would otherwise refuse its own sockets). A bare `wrangler deploy` only _warns_ that no target
was named before picking the top-level config; the script passes `--env=""`, which names it.

The relay's URL is the **indented line under `Deployed … triggers`** — not the last line, since
a `Current Version ID:` follows it. The pinned wrangler (4.107.0) prints no "Published" anywhere;
the real shape is:

```
Uploaded syncticket-relay (… sec)
Deployed syncticket-relay triggers (… sec)
  https://syncticket-relay.<your-subdomain>.workers.dev
Current Version ID: …
```

Write down the host — everything after `https://`, with no trailing slash:
`syncticket-relay.<your-subdomain>.workers.dev`. That `<your-subdomain>` is chosen once per
Cloudflare account and stays the same for every Worker on it, so this is the only time you
need to look it up.

## 2. Build and deploy the app, pointed at the relay

Back in the repo root:

```sh
cd ../..
PUBLIC_RELAY_HOST=syncticket-relay.<your-subdomain>.workers.dev pnpm build
pnpm exec wrangler deploy
```

`PUBLIC_RELAY_HOST` is a **build-time** value (`import.meta.env`, not a runtime secret — see
`AGENTS.md`'s Relay section) baked into the client bundle by `vite build`, which is why it
has to be set on the `build` command specifically, not on `deploy`. Deploying without
rebuilding first ships whatever `PUBLIC_RELAY_HOST` the last build used.

The app's own output ends the same way, with its own `workers.dev` URL — that is the
deployed demo. Open it, and you should land on an empty workspace of your own.

## 3. Verify it actually works

This is not optional polish — a deploy that merely completes without error can still be
broken in ways `wrangler deploy` cannot see (a wrong `PUBLIC_RELAY_HOST`, a Durable Object
migration that did not apply). Confirm, in order:

1. Open the header's connection popover (the cloud icon). On a healthy deploy it reads
   "Connecting…", briefly "Connected, syncing…", then settles on **"Ready to share — no one
   else here yet"** — which proves the relay is reachable and the workspace id round-tripped.
2. Click **Share**, open the copied link in a different browser or a private window, and
   create an issue in one — it should appear in the other within a second.
3. `docs/DEMO.md`'s script, start to finish, in the deployed app rather than local dev.

If step 1 settles on anything else, the popover tells you which mistake you made:

| What it says                       | Icon       | What it means                                                                                                                                                                                                                       |
| ---------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Local only — no relay configured" | hard drive | `PUBLIC_RELAY_HOST` was **not set on the build that got deployed**. This state is never transient — a correctly-built app never shows it at all. Rebuild and redeploy per step 2.                                                   |
| "Not shared — you're offline"      | cloud-off  | `PUBLIC_RELAY_HOST` was set but is **wrong or unreachable**. Check it against the relay's deploy output: `host[:port]` only, no `https://`, no trailing slash. Confirm `https://<relay-host>/` returns the text `syncticket relay`. |

## Redeploying later

Once you know the relay's host, one command does both workers in the right order:

```sh
PUBLIC_RELAY_HOST=syncticket-relay.<your-subdomain>.workers.dev pnpm run deploy
```

That script deploys the relay, rebuilds the app with the host baked in, and deploys the app.
It **refuses to run** if `PUBLIC_RELAY_HOST` is unset rather than quietly shipping a
local-only build — which is the one mistake that produces an app that looks deployed and
silently never syncs. The long form is the same thing spelled out:

```sh
cd workers/relay && pnpm run deploy && cd ../..   # not `wrangler deploy` — see step 1
PUBLIC_RELAY_HOST=syncticket-relay.<your-subdomain>.workers.dev pnpm build && pnpm exec wrangler deploy
```

The relay's `wrangler.jsonc` migration (`new_sqlite_classes`) only runs once, on the first
deploy that introduces it — redeploying does not re-run it or touch existing rooms' data.

## What CI does and does not do

CI (`.github/workflows/ci.yml`) runs `wrangler deploy --dry-run` for both workers on every push
to `main` and on every pull request (`on: push: branches: [main]` plus `pull_request`, so a push
to a branch with no PR open runs nothing) — it validates the bundle, the bindings, and (for the app worker) that every static
asset is under Cloudflare's 25 MiB per-file limit, all without needing a Cloudflare account
at all. It never runs a real `wrangler deploy`: that always requires the authenticated step
above, run by a person, on purpose.

## The deploy that exists

First deployed 2026-10-22, on the free plan, from the account `eleo.666@gmail.com`:

| Worker             | URL                                       | Upload                          |
| ------------------ | ----------------------------------------- | ------------------------------- |
| `syncticket`       | <https://syncticket.eleo-666.workers.dev> | 1,579.82 KiB + 42 static assets |
| `syncticket-relay` | `syncticket-relay.eleo-666.workers.dev`   | 333.83 KiB                      |

Verified per step 3: the popover settled on "Ready to share — no one else here yet", and an
issue created in a second browser given only the share link appeared in the first immediately.

Two measurements worth keeping, because neither is visible once it works. Against the deployed
relay, a malformed room name is refused with `400` on the WebSocket path and `404` on any plain
HTTP request to a room, while a well-formed one upgrades with `101` — both refusals land before
the Durable Object stub is fetched, so a probe creates nothing. The `101` is the half that makes
the rest mean anything: without it a `400` proves only that something said no. (Probe over
HTTP/1.1 — `curl --http1.1`. Over HTTP/2 there is no `Upgrade` header, so the request arrives as
plain HTTP and is correctly answered `404`, which looks like a broken relay and is not one.) And the
largest static asset is the 23.5 MB ONNX runtime, against Cloudflare's 25 MiB per-file cap:
real headroom, but not much, and ADR 0009 put it there on purpose.
