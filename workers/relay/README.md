# workers/relay — the Yjs sync relay

A **separate Cloudflare Worker** exporting the Yjs Durable Object room server. It is separate because the stable adapter-cloudflare cannot export Durable Object classes from the SvelteKit worker, and Wrangler requires a class's migration to live with the worker that defines it — see [ADR 0002](../../docs/adr/0002-deploy-target-cloudflare-workers-free-plan.md).

The browser connects here **directly** over WebSocket. The app worker never proxies sync traffic and has no Durable Object binding at all.

## Stack

- `y-partyserver@2.2.0` — `YServer` on the server, and the client provider at `y-partyserver/provider`. Note the provider is **not** in `partysocket`, which the roadmap originally assumed; `partysocket` is a transitive dependency and nothing here imports it.
- `partyserver@0.5.10` — the `Server` base class, `routePartykitRequest`, and the SQLite helper.

## The one detail that will bite you

partyserver derives the URL namespace by **kebab-casing the Durable Object binding name**. The binding here is `YDocRoom`, so rooms live at:

```
/parties/y-doc-room/<workspace-id>
```

The client provider defaults to a party called `main`, which the relay answers with **HTTP 400**. `src/lib/sync/provider.ts` therefore passes `party: RELAY_PARTY` where `RELAY_PARTY === 'y-doc-room'`. If you rename the binding, rename that constant in the same commit.

## Persistence and hibernation

`static options = { hibernate: true }` lets an idle room be evicted, which is what makes it free — but eviction takes the in-memory `Y.Doc` with it. Everything therefore has to be recoverable: `onLoad` rebuilds the document from the room's own SQLite table and `onSave` writes it back. The save debounce keeps y-partyserver's default 2 s trailing wait and tightens only its 10 s ceiling, to 5 s: the trailing timer is the worst case, because a gap longer than it fires the save, so bursty typing costs more writes than continuous editing — at the 300 ms this once used, up to ~288,000 row writes a day against an account-wide free-plan budget of 100,000 ([ADR 0010](../../docs/adr/0010-relay-snapshot-durability.md)). The price is that up to 5 s of the newest changes live only in evictable memory, which is safe because every client holds the whole document in IndexedDB and re-syncs.

## Commands

```sh
pnpm --filter syncticket-relay dev       # wrangler dev on :18791
pnpm --filter syncticket-relay run check # wrangler types + tsc
pnpm --filter syncticket-relay run dry-run
```

Playwright starts this automatically; see `playwright.config.ts`.

## Connecting the app to it

Set `PUBLIC_RELAY_HOST` at **build** time, as `host[:port]` with no protocol and no path:

```sh
PUBLIC_RELAY_HOST=localhost:18791 pnpm build
```

The port matters locally: the provider only picks `ws://` for hosts it recognises as local, so a bare hostname would be dialled over `wss://`. With the variable unset the app builds and runs exactly as it did before Phase 9 — local-first, no socket.
