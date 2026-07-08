// IndexedDB persistence for a workspace's Y.Doc. y-indexeddb is the offline source of
// truth; edits queue locally and (from Phase 9) merge with the relay on reconnect.

import { browser } from '$app/environment';
import { IndexeddbPersistence } from 'y-indexeddb';
import type * as Y from 'yjs';
import { workspaceDbName } from '$lib/model/workspace.js';

export interface WorkspacePersistence {
	readonly provider: IndexeddbPersistence | null;
	/** Resolves once the initial IndexedDB load has been applied to the doc. */
	whenSynced: Promise<void>;
	destroy(): Promise<void>;
}

/**
 * Attaches IndexedDB persistence in the browser; a no-op on the server (SSR/workerd) and
 * in tests that don't opt in.
 *
 * The import is static and attachment synchronous *by design*: y-indexeddb only captures
 * doc updates emitted after it subscribes, so a write made before attachment (e.g. a user
 * who creates an issue and reloads within a chunk-load window) would never be persisted.
 * A dynamic `import('y-indexeddb')` reintroduces exactly that lost-write window. The static
 * import is SSR-safe — only instantiation touches `indexedDB`, and esbuild dead-code-
 * eliminates the browser-only branch from the server bundle.
 */
export function attachPersistence(doc: Y.Doc, workspaceId: string): WorkspacePersistence {
	if (!browser) {
		return { provider: null, whenSynced: Promise.resolve(), destroy: async () => {} };
	}
	const provider = new IndexeddbPersistence(workspaceDbName(workspaceId), doc);
	return {
		provider,
		whenSynced: provider.whenSynced.then(() => undefined),
		destroy: () => provider.destroy()
	};
}
