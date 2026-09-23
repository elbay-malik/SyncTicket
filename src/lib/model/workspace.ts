// A workspace is the unit of sharding: one Y.Doc, one IndexedDB database, and (from Phase 9)
// one Durable Object room — all keyed by the workspace id.

export const WORKSPACE_DB_PREFIX = 'syncticket';

/**
 * Sentinel meaning "no workspace", used on the server, where there is no URL to read and no
 * document to sync.
 *
 * Deliberately **not** a workspace anyone can be in: `isWorkspaceId` rejects it, so it can
 * never arrive from a `?ws=` parameter or from storage, and `chooseWorkspace` never returns
 * it. It is the one id in the system a stranger could guess, and guessing an id is the only
 * way into a workspace at all (ADR 0004).
 */
export const DEFAULT_WORKSPACE_ID = 'default';

/** Query parameter carrying the workspace id, and the key it is remembered under. */
export const WORKSPACE_PARAM = 'ws';
export const WORKSPACE_STORAGE_KEY = 'syncticket:workspace';

/**
 * Ids are used verbatim in an IndexedDB database name and a Durable Object room name, so
 * they are restricted to characters that are unambiguous in both.
 *
 * Wider than what the relay will actually open a room for (`ROOM_NAME` in
 * workers/relay/src/rooms.ts requires `^[a-z][0-9a-f]{32}$`, the shape `createWorkspaceId`
 * mints): this side also has to keep accepting ids already written to a visitor's storage,
 * and rejecting one here would strand them in a new, empty workspace.
 */
const VALID_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isWorkspaceId(value: unknown): value is string {
	// The sentinel is excluded here rather than at each call site, so there is no path — URL,
	// storage, or anything added later — that can turn it into a real room. It also evicts a
	// browser that already remembers it, which an earlier build could write.
	return typeof value === 'string' && value !== DEFAULT_WORKSPACE_ID && VALID_ID.test(value);
}

/** What {@link chooseWorkspace} made of the id sources it was given. */
export interface WorkspaceResolution {
	/** The workspace this session belongs to. Never {@link DEFAULT_WORKSPACE_ID}. */
	id: string;
	/**
	 * The raw `?ws=` value when the URL carried one that is not a usable id, else null.
	 *
	 * Reported rather than swallowed: falling back to another workspace is the right thing to
	 * do, but doing it silently leaves someone typing into a workspace that is not the one
	 * they were invited to, with no way to tell.
	 */
	invalidParam: string | null;
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

/**
 * Decides which workspace a session belongs to, from the URL and whatever this browser
 * remembered — minting one when neither offers a usable id.
 *
 * An id in the URL wins over a remembered one, and keeping it out of every internal link is
 * deliberate: once a visitor arrives with `?ws=…` the id is remembered, so ordinary
 * navigation and reloads stay in that workspace without every `resolve()` call in the app
 * having to thread a query parameter through. That is the shareable capability URL ADR 0004
 * describes.
 *
 * Both halves of the decision live here, and the minting is not optional. Split across two
 * modules it once read "mint, unless this browser remembered something", which quietly made
 * `?ws=default` — the one id in the system a stranger can guess — a real, joinable room for
 * every returning visitor.
 */
export function chooseWorkspace(search: string, remembered: string | null): WorkspaceResolution {
	const fromUrl = new URLSearchParams(search).get(WORKSPACE_PARAM);
	if (isWorkspaceId(fromUrl)) return { id: fromUrl, invalidParam: null };
	// Past this point the parameter was either absent (null) or present and unusable, which
	// is exactly what `invalidParam` reports — so both fallbacks can carry it as it stands.
	if (isWorkspaceId(remembered)) return { id: remembered, invalidParam: fromUrl };
	return { id: createWorkspaceId(), invalidParam: fromUrl };
}

/** The link that invites someone into `workspaceId`. */
export function workspaceShareUrl(origin: string, workspaceId: string): string {
	return `${origin}/issues?${WORKSPACE_PARAM}=${encodeURIComponent(workspaceId)}`;
}

/** IndexedDB database name for a workspace's persisted Y.Doc. */
export function workspaceDbName(workspaceId: string): string {
	return `${WORKSPACE_DB_PREFIX}:${workspaceId}`;
}
