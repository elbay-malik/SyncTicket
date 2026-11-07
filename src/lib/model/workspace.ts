// A workspace is the unit of sharding: one Y.Doc, one IndexedDB database, and (from Phase 9)
// one Durable Object room — all keyed by the workspace id.

import { randomUUID } from './uuid.js';

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
/** The workspaces this browser has opened, most recent first. See {@link rememberVisit}. */
export const VISITED_STORAGE_KEY = 'syncticket:workspaces';
/** How many workspaces {@link VISITED_STORAGE_KEY} keeps. */
export const VISITED_LIMIT = 10;

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

/**
 * The shape `createWorkspaceId` mints, and the only one the relay opens a room for
 * (`ROOM_NAME` in workers/relay/src/rooms.ts; the e2e fixtures mint it with a `t`).
 */
const SHAREABLE_ID = /^[a-z][0-9a-f]{32}$/;

/**
 * The workspace a link's `?ws=` value names, or null when it names none.
 *
 * Stricter than {@link isWorkspaceId}, which also has to accept ids already in a visitor's
 * storage. A link is held to the shape the relay accepts, because anything else is a link that
 * was damaged on the way: cut short by a chat client, or with a character lost in a copy. Taken
 * at face value it opened an empty workspace that could never sync, said "you're offline" while
 * the network was fine, and replaced the visitor's remembered workspace with the dead one.
 *
 * A value that differs only in case is the same id: ids are lower-case hex, so upper-casing
 * (some mail and chat clients do it to links) loses nothing, and the original is restored.
 *
 * `known` (the remembered id and every workspace this browser has opened) is let through as it
 * stands, so a workspace this browser holds under an id of an older shape can still be reloaded,
 * and gone back to, from the address it is shown.
 */
export function linkedWorkspaceId(
	value: string | null,
	known: readonly (string | null)[]
): string | null {
	if (value === null) return null;
	if (isWorkspaceId(value) && known.includes(value)) return value;
	const id = value.toLowerCase();
	return SHAREABLE_ID.test(id) ? id : null;
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
	/**
	 * The workspace this browser remembers, when a link opened a different one, else null. That
	 * remembered workspace stays the one a bare address opens until the visitor chooses
	 * otherwise. A link used to replace it without a word: a visitor's own issues seemed to have
	 * gone, and everything they typed afterwards went to whoever sent the link.
	 */
	leftBehind: string | null;
	/** True when the link opened a workspace this browser had never opened before. */
	newToBrowser: boolean;
	/**
	 * True when the id was minted just now, so this browser started the workspace and nobody
	 * can have shared anything into it yet. An id from a link or from storage may already hold
	 * someone's issues on the relay.
	 */
	minted: boolean;
}

/**
 * Mints an unguessable workspace id.
 *
 * Unguessability is the whole access-control story in demo mode: knowing the link is what
 * grants access, so the id has to be long and random rather than sequential or memorable.
 */
export function createWorkspaceId(): string {
	return `w${randomUUID().replace(/-/g, '')}`;
}

/**
 * Decides which workspace a session belongs to, from the URL and whatever this browser
 * remembered — minting one when neither offers a usable id.
 *
 * An id in the URL wins over a remembered one, if it is one a link can carry (see
 * {@link linkedWorkspaceId}). `visited` is every workspace this browser has opened: those are let
 * through whatever their shape, and say whether the link's workspace is new to this browser. Internal links still do not carry it — every
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
export function chooseWorkspace(
	search: string,
	remembered: string | null,
	visited: readonly string[] = []
): WorkspaceResolution {
	const fromUrl = new URLSearchParams(search).get(WORKSPACE_PARAM);
	const linked = linkedWorkspaceId(fromUrl, [remembered, ...visited]);
	if (linked !== null) {
		const away = isWorkspaceId(remembered) && remembered !== linked;
		return {
			id: linked,
			invalidParam: null,
			leftBehind: away ? remembered : null,
			newToBrowser: !visited.includes(linked) && linked !== remembered,
			minted: false
		};
	}
	// Past this point the parameter was either absent (null) or present and unusable, which
	// is exactly what `invalidParam` reports — so both fallbacks can carry it as it stands.
	if (isWorkspaceId(remembered)) {
		return {
			id: remembered,
			invalidParam: fromUrl,
			leftBehind: null,
			newToBrowser: false,
			minted: false
		};
	}
	return {
		id: createWorkspaceId(),
		invalidParam: fromUrl,
		leftBehind: null,
		newToBrowser: false,
		minted: true
	};
}

/**
 * The visited list as stored, keeping only usable ids: it comes out of storage that anything
 * running on this origin can write to.
 */
export function readVisited(stored: unknown): string[] {
	return Array.isArray(stored) ? stored.filter(isWorkspaceId).slice(0, VISITED_LIMIT) : [];
}

/**
 * The visited list after opening `id`: it moves to the front, `previous` (the workspace that was
 * remembered until now, which an older build never listed) goes after it, and the oldest drop
 * off past {@link VISITED_LIMIT}.
 */
export function rememberVisit(
	earlier: readonly string[],
	id: string,
	previous: string | null
): string[] {
	const order = [id, ...(isWorkspaceId(previous) ? [previous] : []), ...earlier];
	return [...new Set(order)].slice(0, VISITED_LIMIT);
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
export function workspaceAddress(
	url: URL,
	workspaceId: string,
	visited: readonly string[] = []
): WorkspaceAddress {
	const values = url.searchParams.getAll(WORKSPACE_PARAM);
	// Exactly one, and the right one. A repeated parameter is rewritten even when the first copy
	// is correct, so a pasted link cannot carry a second id that some other reader picks.
	if (values.length === 1 && values[0] === workspaceId) return { kind: 'keep' };
	// Judged as a link, the same way `chooseWorkspace` judged it. Reloading for a value it would
	// refuse loops for ever: the reload falls back to this workspace and asks again.
	const named = linkedWorkspaceId(values[0] ?? null, [workspaceId, ...visited]);
	if (values.length === 1 && named !== null && named !== workspaceId) {
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
