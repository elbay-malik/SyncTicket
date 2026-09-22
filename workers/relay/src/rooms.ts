// Which room names this relay will open a Durable Object for.
//
// Pure and dependency-free on purpose, like `storage.ts`: the worker entry imports
// `cloudflare:`-scheme modules that a Node test runner cannot load, so anything that needs
// testing has to live outside it.

/**
 * The shape `createWorkspaceId()` mints (`src/lib/model/workspace.ts` — a letter followed by
 * 32 hex characters; the e2e fixtures mint the same shape with a `t` prefix), and nothing
 * else.
 *
 * This is a deliberate coupling across the two workers, the same kind as the party name in
 * `wrangler.jsonc`: change the client's id format and this must change with it.
 *
 * Without it, `routePartykitRequest` hands any name at all straight to
 * `doNamespace.get(id).fetch()` (partyserver `dist/index.js:538`), and a Durable Object —
 * with its own SQLite storage — is created for it. Not just over WebSocket: a plain GET
 * initialises the instance (`Server.fetch` awaits `#ensureInitialized()` before it decides
 * the request is not an upgrade), so one unauthenticated `curl` per name was enough to
 * create unbounded rooms. Requiring a 128-bit id the app itself generated removes the
 * enumeration primitive entirely: a stranger cannot guess a routable name.
 */
export const ROOM_NAME = /^[a-z][0-9a-f]{32}$/;

/** True when `name` is a room this relay is willing to bring into existence. */
export function isRoutableRoom(name: string): boolean {
	return ROOM_NAME.test(name);
}
