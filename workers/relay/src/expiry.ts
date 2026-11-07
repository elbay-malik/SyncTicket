// When a room's storage is deleted.
//
// Pure and dependency-free on purpose, like `rooms.ts`: the worker entry imports
// `cloudflare:`-scheme modules a Node test runner cannot load.
//
// Nothing used to delete a room, ever. Room names cannot be listed, so rooms nobody uses could
// not be picked out either, and anyone could fill the account's Durable Object storage, which
// does not reset like the daily budgets do, with rooms holding a snapshot each. Writes would then
// fail for every room, until the owner wiped all of them by hand.
//
// So every room expires a fixed time after its last save, unless someone is in it. A workspace
// someone still has open in a browser is not lost: the browser holds the whole document in
// IndexedDB and uploads it again on its next connect. What expiry does lose is a room's copy for
// a newcomer while nobody who has the workspace is around (ADR 0010).

/** How long after its last save a room keeps its storage. */
export const ROOM_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * How far behind the target an alarm may be before it is moved. Saves come every few seconds
 * while someone types; moving the alarm on each of them would cost a storage write each time.
 */
export const REARM_SLACK_MS = 60 * 60 * 1000;

/**
 * When to set the room's alarm after a save or a wake at `now`, or null to leave it as it is.
 * `current` is the alarm already set, if any.
 */
export function nextExpiry(now: number, current: number | null, ttl = ROOM_TTL_MS): number | null {
	const target = now + ttl;
	if (current !== null && current >= target - REARM_SLACK_MS) return null;
	return target;
}

/**
 * What a room does when its alarm fires: expire if nobody is connected, otherwise put it off for
 * another full term. Someone connected is someone using the room, whether or not they have saved
 * anything lately.
 */
export function onExpiry(
	connections: number,
	now: number,
	ttl = ROOM_TTL_MS
): { action: 'expire' } | { action: 'postpone'; until: number } {
	return connections > 0 ? { action: 'postpone', until: now + ttl } : { action: 'expire' };
}
