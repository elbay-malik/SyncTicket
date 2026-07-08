# workers/relay — Yjs sync relay (arrives in Phase 9)

This directory will hold a **separate Cloudflare Worker** that exports the Yjs Durable Object room server. It is separate because the stable adapter-cloudflare cannot export DO classes from the SvelteKit worker, and DO migrations must live in the config of the worker that defines the class — see [ADR 0002](../../docs/adr/0002-deploy-target-cloudflare-workers-free-plan.md).

Planned stack (pins verified 2026-07-08; re-verify at install time):

- `y-partyserver@2.2.0` — `YServer` extends Cloudflare's `Server`/`DurableObject`, WebSocket Hibernation supported
- `partysocket@1.3.0` — client-side `YProvider` (used in `src/lib/sync/provider.ts`)

Planned `wrangler.jsonc` shape:

```jsonc
{
	"name": "syncticket-relay",
	"main": "src/index.ts",
	"compatibility_date": "2026-07-06",
	"durable_objects": {
		"bindings": [{ "name": "Y_DOC", "class_name": "YDocRoom" }]
	},
	// Free plan only allows SQLite-backed DOs — migrations live HERE, not in the app worker.
	"migrations": [{ "tag": "v1", "new_sqlite_classes": ["YDocRoom"] }]
}
```

When this phase starts: add `packages: ["workers/*"]` to `pnpm-workspace.yaml` and give this directory its own `package.json`.
