// The bridge from CRDT to Svelte reactivity: observes the issues Y.Map and maintains a
// reactive projection (SvelteMap of plain Issue snapshots). Yjs is the source of truth;
// this is a derived view recomputed incrementally from Y events. Writes go straight to
// the CRDT (src/lib/sync/issues) — the projection updates through the observer, so the
// UI never mutates local state directly.

import { browser } from '$app/environment';
import { SvelteMap } from 'svelte/reactivity';
import type * as Y from 'yjs';
import { currentWorkspaceId } from '$lib/model/workspace.js';
import type { Issue, IssuePatch, NewIssueInput } from '$lib/model/issue.js';
import { createDoc, getIssuesMap, type YIssue } from '$lib/sync/doc.js';
import { createIssue, deleteIssue, patchIssue, readIssue } from '$lib/sync/issues.js';
import { attachPersistence, type WorkspacePersistence } from '$lib/sync/persistence.js';

export class IssueStore {
	#doc: Y.Doc;
	#map: Y.Map<YIssue>;
	#persistence: WorkspacePersistence;
	#byId = new SvelteMap<string, Issue>();
	#synced = $state(false);

	constructor(workspaceId: string = currentWorkspaceId()) {
		this.#doc = createDoc();
		this.#map = getIssuesMap(this.#doc);
		this.#map.observeDeep(this.#onChange);
		this.#persistence = attachPersistence(this.#doc, workspaceId);
		void this.#persistence.whenSynced.then(
			() => {
				this.#reindex();
				this.#synced = true;
			},
			// If IndexedDB is unavailable (private mode, quota, blocked), degrade to an
			// in-memory session instead of hanging forever on the loading skeleton.
			() => {
				this.#synced = true;
			}
		);
	}

	/** True once the local load has completed (immediately when there's no persistence). */
	get synced(): boolean {
		return this.#synced;
	}

	get all(): Issue[] {
		return [...this.#byId.values()];
	}

	get(id: string): Issue | undefined {
		return this.#byId.get(id);
	}

	create(input?: NewIssueInput): string {
		return createIssue(this.#map, input);
	}

	update(id: string, patch: IssuePatch): void {
		patchIssue(this.#map, id, patch);
	}

	remove(id: string): void {
		deleteIssue(this.#map, id);
	}

	destroy(): void {
		this.#map.unobserveDeep(this.#onChange);
		void this.#persistence.destroy();
		this.#doc.destroy();
	}

	/** Full idempotent resync of the projection from the CRDT (runs once, post-load). */
	#reindex(): void {
		this.#byId.clear();
		for (const [id, yIssue] of this.#map) this.#byId.set(id, readIssue(id, yIssue));
	}

	// Incrementally patches only the issues each Y event touches. Top-level events carry
	// whole-issue adds/deletes; nested events carry a field change whose path[0] is the id.
	#onChange = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>): void => {
		for (const event of events) {
			if (event.path.length === 0) {
				for (const [key, change] of event.changes.keys) {
					if (change.action === 'delete') {
						this.#byId.delete(key);
					} else {
						const yIssue = this.#map.get(key);
						if (yIssue) this.#byId.set(key, readIssue(key, yIssue));
					}
				}
			} else {
				const id = event.path[0];
				if (typeof id !== 'string') continue;
				const yIssue = this.#map.get(id);
				if (yIssue) this.#byId.set(id, readIssue(id, yIssue));
				else this.#byId.delete(id);
			}
		}
	};
}

let browserStore: IssueStore | null = null;

/**
 * The shared workspace store. In the browser it's a session singleton; on the server a
 * fresh empty store is returned per render so no request leaks synced state into another
 * (which would cause a hydration mismatch).
 */
export function getIssueStore(): IssueStore {
	if (!browser) return new IssueStore();
	if (!browserStore) browserStore = new IssueStore();
	return browserStore;
}

// Tear the singleton down on hot-module replacement so dev reloads don't leak observers
// and IndexedDB connections.
if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		browserStore?.destroy();
		browserStore = null;
	});
}
