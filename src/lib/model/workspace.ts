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
 * An id in the URL wins over a remembered one. Internal links still do not carry it — every
 * `resolve()` call in the app would otherwise have to thread a query parameter through — so
 * the id is also remembered, and that memory is what keeps a navigation or a reload in the
 * same workspace. The address bar is then put back in step after every navigation (see
 * {@link workspaceAddress}), so the URL a visitor sees is always the shareable capability URL
 * ADR 0004 describes, never a bare path that would open someone else a fresh workspace.
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

/** What the address bar has to do to show the workspace this session belongs to. */
export type WorkspaceAddress =
	{ kind: 'keep' } | { kind: 'replace'; url: URL } | { kind: 'reload' };

/**
 * Decides whether `url` — where the address bar is now — already names `workspaceId`, and if
 * not, what it should say instead.
 *
 * The address bar is the workspace link: an evaluator who copies it to a phone has to land in
 * this workspace, not in a fresh, empty one that makes sync look broken. Internal links carry
 * no `?ws=` (see {@link chooseWorkspace}), so after every navigation the parameter is missing
 * and comes back here as a `replace`. So does an unusable one — the session already fell back
 * to another workspace, and left in the address bar a bad id goes on looking like it worked,
 * survives a reload and is passed along by anyone who copies it.
 *
 * Only `?ws=` changes. The path, every other parameter and the hash are kept, so an issue
 * sheet that was deep-linked to stays open and nothing else in the link is lost.
 *
 * `reload` is the one case a rewrite would be wrong: the URL names a *different*, usable
 * workspace. The session is bound to one document for its lifetime, so rewriting the address
 * to match it would quietly drop the workspace someone was sent to; loading the page again
 * lets `chooseWorkspace` take the URL's id, as it does for any arriving link.
 */
export function workspaceAddress(url: URL, workspaceId: string): WorkspaceAddress {
	const values = url.searchParams.getAll(WORKSPACE_PARAM);
	// Exactly one, and the right one. A repeated parameter is rewritten even when the first copy
	// is correct, so a pasted link cannot carry a second id that some other reader picks.
	if (values.length === 1 && values[0] === workspaceId) return { kind: 'keep' };
	const named = values[0] ?? null;
	if (values.length === 1 && isWorkspaceId(named) && named !== workspaceId) {
		return { kind: 'reload' };
	}
	const next = new URL(url);
	next.searchParams.set(WORKSPACE_PARAM, workspaceId);
	return { kind: 'replace', url: next };
}

/** The link that invites someone into `workspaceId`. */
export function workspaceShareUrl(origin: string, workspaceId: string): string {
	return `${origin}/issues?${WORKSPACE_PARAM}=${encodeURIComponent(workspaceId)}`;
}

/** IndexedDB database name for a workspace's persisted Y.Doc. */
export function workspaceDbName(workspaceId: string): string {
	return `${WORKSPACE_DB_PREFIX}:${workspaceId}`;
}
