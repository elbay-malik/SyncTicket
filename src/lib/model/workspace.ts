// A workspace is the unit of sharding: one Y.Doc, one IndexedDB database, and (from Phase 9)
// one Durable Object room — all keyed by the workspace id.

export const WORKSPACE_DB_PREFIX = 'syncticket';

/**
 * Fallback workspace, used on the server and when a browser cannot remember anything.
 *
 * A real visitor does not land here: with no id in the URL and nothing remembered, one is
 * minted, so each browser starts in a workspace of its own and joins another only by being
 * given its link (ADR 0004).
 */
export const DEFAULT_WORKSPACE_ID = 'default';

/** Query parameter carrying the workspace id, and the key it is remembered under. */
export const WORKSPACE_PARAM = 'ws';
export const WORKSPACE_STORAGE_KEY = 'syncticket:workspace';

/**
 * Ids are used verbatim in an IndexedDB database name and a Durable Object room name, so
 * they are restricted to characters that are unambiguous in both.
 */
const VALID_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isWorkspaceId(value: unknown): value is string {
	return typeof value === 'string' && VALID_ID.test(value);
}

/**
 * Resolves the workspace to use, preferring an id carried in the URL over a remembered one.
 *
 * Keeping it out of every internal link is deliberate: once a visitor arrives with `?ws=…`
 * the id is remembered, so ordinary navigation and reloads stay in that workspace without
 * every `resolve()` call in the app having to thread a query parameter through. Phase 12
 * turns this into the shareable capability URL that ADR 0004 describes.
 */
export function resolveWorkspaceId(search: string, remembered: string | null): string {
	const fromUrl = new URLSearchParams(search).get(WORKSPACE_PARAM);
	if (isWorkspaceId(fromUrl)) return fromUrl;
	if (isWorkspaceId(remembered)) return remembered;
	return DEFAULT_WORKSPACE_ID;
}

/**
 * Mints an unguessable workspace id.
 *
 * Unguessability is the whole access-control story in demo mode: knowing the link is what
 * grants access, so the id has to be long and random rather than sequential or memorable.
 */
export function createWorkspaceId(): string {
	return `w${crypto.randomUUID().replace(/-/g, '')}`;
}

/** The link that invites someone into `workspaceId`. */
export function workspaceShareUrl(origin: string, workspaceId: string): string {
	return `${origin}/issues?${WORKSPACE_PARAM}=${encodeURIComponent(workspaceId)}`;
}

/** IndexedDB database name for a workspace's persisted Y.Doc. */
export function workspaceDbName(workspaceId: string): string {
	return `${WORKSPACE_DB_PREFIX}:${workspaceId}`;
}
