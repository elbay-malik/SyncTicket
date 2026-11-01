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
		// Derived from *both* of y-indexeddb's signals, not just `whenSynced`.
		//
		// `whenSynced` is created resolve-only (`y-indexeddb.js:80` —
		// `promise.create(resolve => this.on('synced', …))`, with no reject path), and the
		// `openDB` failure it would need to hear about lands on the separate `_db` promise,
		// which the library then `.then()`s without a `.catch` (`:82`). So a browser that
		// refuses IndexedDB — blocked site data, a strict Firefox profile, a cross-site
		// iframe under storage partitioning — produces an unhandled rejection and leaves
		// `whenSynced` pending *forever*. Every caller of this promise gates its loading
		// skeleton on it, so the whole app would hang on a spinner with no error and no way
		// forward. Racing `_db`'s rejection against it is what makes the store's
		// degrade-to-in-memory path reachable at all, and marks that rejection handled.
		//
		// A throw while applying what was stored has no such signal: y-indexeddb starts that
		// fetch without keeping its promise, so 'synced' just never fires. That is why nothing a
		// peer can store may throw out of Y.applyUpdate, which is what patches/yjs@*.patch is for.
		whenSynced: new Promise<void>((resolve, reject) => {
			void provider.whenSynced.then(() => resolve());
			provider._db.catch(reject);
		}),
		destroy: () => provider.destroy()
	};
}
