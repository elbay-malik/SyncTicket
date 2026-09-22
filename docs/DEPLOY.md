# Deploying to Cloudflare

Both workers deploy on the free plan — no custom domain, no paid tier, no account
configuration beyond having a Cloudflare account at all. This is a runbook, not a script:
every command below is meant to be read and run by a person, once, the first time. It is not
something this repo's automation runs for you — `wrangler deploy` (unlike the `--dry-run`
CI already does on every push) changes what a live URL serves, and needs a logged-in,
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

`wrangler whoami` confirms you're logged in. If it says "You are not authenticated", `login`
did not complete.

## 1. Deploy the relay first

The app's build needs to know the relay's URL, and the relay's URL only exists once it has
been deployed at least once — so it goes first.

```sh
cd workers/relay
pnpm exec wrangler deploy
```

The last line of output is the relay's URL, something like:

```
Published syncticket-relay (…)
  https://syncticket-relay.<your-subdomain>.workers.dev
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
cd workers/relay && pnpm exec wrangler deploy && cd ../..
PUBLIC_RELAY_HOST=syncticket-relay.<your-subdomain>.workers.dev pnpm build && pnpm exec wrangler deploy
```

The relay's `wrangler.jsonc` migration (`new_sqlite_classes`) only runs once, on the first
deploy that introduces it — redeploying does not re-run it or touch existing rooms' data.

## What CI does and does not do

CI (`.github/workflows/ci.yml`) runs `wrangler deploy --dry-run` for both workers on every
push — it validates the bundle, the bindings, and (for the app worker) that every static
asset is under Cloudflare's 25 MiB per-file limit, all without needing a Cloudflare account
at all. It never runs a real `wrangler deploy`: that always requires the authenticated step
above, run by a person, on purpose.
