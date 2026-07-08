// A workspace is the unit of sharding: one Y.Doc, one IndexedDB database, and later
// (Phase 9) one Durable Object room — all keyed by the workspace id.

export const WORKSPACE_DB_PREFIX = 'syncticket';

/**
 * Placeholder single-workspace id for the local-first phases. Phase 9 replaces this
 * with an unguessable capability id carried in the URL (see ADR 0004).
 */
export const DEFAULT_WORKSPACE_ID = 'default';

/** IndexedDB database name for a workspace's persisted Y.Doc. */
export function workspaceDbName(workspaceId: string): string {
	return `${WORKSPACE_DB_PREFIX}:${workspaceId}`;
}

/** Returns the active workspace id. Constant for now; URL-driven from Phase 9. */
export function currentWorkspaceId(): string {
	return DEFAULT_WORKSPACE_ID;
}
