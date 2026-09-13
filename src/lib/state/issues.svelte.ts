// The bridge from CRDT to Svelte reactivity: observes the issues Y.Map and maintains a
// reactive projection (SvelteMap of plain Issue snapshots). Yjs is the source of truth;
// this is a derived view recomputed incrementally from Y events. Writes go straight to
// the CRDT (src/lib/sync/issues) — the projection updates through the observer, so the
// UI never mutates local state directly.

import { browser } from '$app/environment';
import { SvelteMap } from 'svelte/reactivity';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import {
	DEFAULT_WORKSPACE_ID,
	WORKSPACE_STORAGE_KEY,
	createWorkspaceId,
	resolveWorkspaceId
} from '$lib/model/workspace.js';
import type { Issue, IssuePatch, IssueStatus, NewIssueInput } from '$lib/model/issue.js';
import { createDoc, getIssuesMap, type YIssue } from '$lib/sync/doc.js';
import { createIssue, deleteIssue, moveIssue, patchIssue, readIssue } from '$lib/sync/issues.js';
import { seedIssues, seedDemoIssues, type SeedOptions } from '$lib/sync/seed.js';
import { attachPersistence, type WorkspacePersistence } from '$lib/sync/persistence.js';
import { attachRelay, type RelayConnection } from '$lib/sync/provider.js';
import { ConnectionStatus, type ConnectionState } from '$lib/sync/connection.svelte.js';

/** What changed in one CRDT batch. Emitted to listeners such as the search index. */
export interface IssueDelta {
	upserted: readonly Issue[];
	removed: readonly string[];
	/** True when the whole projection was rebuilt and listeners should start over. */
	reset: boolean;
}

/**
 * The workspace this session belongs to.
 *
 * Read once and remembered, so ordinary navigation and reloads stay put without every
 * internal link having to carry the id. On the server there is no URL to read and the store
 * is empty anyway, so the default is correct there.
 */
function sessionWorkspaceId(): string {
	if (!browser) return DEFAULT_WORKSPACE_ID;
	let remembered: string | null = null;
	try {
		remembered = localStorage.getItem(WORKSPACE_STORAGE_KEY);
	} catch {
		// Private mode or blocked storage; the URL or the default still works.
	}
	// A visitor with no link and nothing remembered gets a workspace of their own rather than
	// landing in a shared one: the id is the only thing standing between a workspace and the
	// rest of the internet (ADR 0004), so it has to be unguessable from the first visit.
	const resolved = resolveWorkspaceId(location.search, remembered);
	const id = resolved === DEFAULT_WORKSPACE_ID && !remembered ? createWorkspaceId() : resolved;
	try {
		if (id !== remembered) localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
	} catch {
		// Not being able to remember it only costs us the id on the next reload.
	}
	return id;
}

export class IssueStore {
	#doc: Y.Doc;
	#map: Y.Map<YIssue>;
	#persistence: WorkspacePersistence;
	#relay: RelayConnection;
	// Not itself $state — ConnectionStatus holds its own runes and this store's `connection`
	// getter reads straight through to `displayed`, the same pattern `awareness` uses for
	// the relay connection.
	#status = new ConnectionStatus();
	#relaySynced = $state(false);
	#byId = new SvelteMap<string, Issue>();
	/** Which workspace this store is bound to; the relay uses it as the room name. */
	readonly workspaceId: string;
	// A plain array, not a Set: eslint's svelte/prefer-svelte-reactivity rejects a bare Set in
	// a .svelte.ts module, and this collection is never read reactively anyway.
	#listeners: Array<(delta: IssueDelta) => void> = [];
	#synced = $state(false);
	#persisted = $state(true);

	constructor(workspaceId: string = sessionWorkspaceId()) {
		this.workspaceId = workspaceId;
		this.#doc = createDoc();
		this.#map = getIssuesMap(this.#doc);
		this.#map.observeDeep(this.#onChange);
		this.#persistence = attachPersistence(this.#doc, workspaceId);
		// Attached synchronously, like persistence: a provider that arrives late misses the
		// updates made in the gap. A remote update arriving before IndexedDB has finished
		// loading is safe, because the post-load rebuild re-reads the whole Y.Map.
		this.#relay = attachRelay(this.#doc, workspaceId, {
			onConnection: (state) => this.#status.report(state),
			onOffline: () => this.#status.reportCertainOffline(),
			onSynced: (synced) => (this.#relaySynced = synced)
		});
		void this.#persistence.whenSynced.then(
			() => {
				this.#reindex();
				this.#synced = true;
			},
			// If IndexedDB is unavailable (private mode, quota, blocked), degrade to an
			// in-memory session instead of hanging forever on the loading skeleton. The
			// failure is recorded rather than swallowed: "your work is saved on this
			// device" is the one promise a local-first app must not make falsely.
			() => {
				this.#persisted = false;
				this.#synced = true;
			}
		);
	}

	/**
	 * The awareness channel for this workspace, present with or without a relay.
	 *
	 * Handed to `Presence` rather than consumed here: awareness carries no document state,
	 * so it has no business in the CRDT projection.
	 */
	get awareness(): Awareness {
		return this.#relay.awareness;
	}

	/**
	 * Where the relay connection stands, smoothed against the flap a normal retry loop
	 * produces. 'local' means no relay is configured at all — nothing is wrong, there is
	 * simply nothing to connect to.
	 */
	get connection(): ConnectionState {
		return this.#status.displayed;
	}

	/**
	 * False when this browser could not open its local database.
	 *
	 * Private-mode windows, a denied storage permission and an exhausted quota all land
	 * here. The session still works, but nothing survives the tab closing, and the UI has
	 * to say so rather than promise durability it does not have.
	 */
	get persisted(): boolean {
		return this.#persisted;
	}

	/** True once this client and the relay have exchanged state. */
	get relaySynced(): boolean {
		return this.#relaySynced;
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

	/**
	 * Board drop: put `id` into `status` at the position implied by `orderedIds` (the target
	 * column's ids in their new display order, including `id`). Key maths lives in sync/.
	 */
	move(id: string, status: IssueStatus, orderedIds: readonly string[]): void {
		moveIssue(this.#map, id, status, orderedIds);
	}

	/**
	 * Subscribes to projection changes, returning the unsubscribe function.
	 *
	 * The search index needs deltas rather than a snapshot: re-sending 10,000 documents on
	 * every keystroke is not an option, and polling `all` cannot tell what was removed. The
	 * post-load rebuild emits a `reset` because it repopulates the projection without any Y
	 * event, so a listener that only watched CRDT deltas would never learn about the issues
	 * that were already in the document when it loaded.
	 */
	onChange(listener: (delta: IssueDelta) => void): () => void {
		this.#listeners.push(listener);
		return () => {
			const index = this.#listeners.indexOf(listener);
			if (index !== -1) this.#listeners.splice(index, 1);
		};
	}

	#emit(delta: IssueDelta): void {
		if (delta.upserted.length === 0 && delta.removed.length === 0 && !delta.reset) return;
		for (const listener of this.#listeners) listener(delta);
	}

	/** Bulk-appends generated issues in one transaction, for benchmarking at scale. */
	seed(count: number, options?: SeedOptions): string[] {
		return seedIssues(this.#map, count, options);
	}

	/** Appends a small curated backlog. Called only from the empty state's own button. */
	seedDemo(): string[] {
		return seedDemoIssues(this.#map);
	}

	destroy(): void {
		this.#map.unobserveDeep(this.#onChange);
		// The relay goes first: it does not detach itself on doc.destroy(), so a socket left
		// open would apply an inbound sync message to a destroyed document.
		this.#relay.destroy();
		this.#status.destroy();
		void this.#persistence.destroy();
		this.#doc.destroy();
	}

	/** Full idempotent resync of the projection from the CRDT (runs once, post-load). */
	#reindex(): void {
		this.#byId.clear();
		for (const [id, yIssue] of this.#map) this.#byId.set(id, readIssue(id, yIssue));
		this.#emit({ upserted: [...this.#byId.values()], removed: [], reset: true });
	}

	// Incrementally patches only the issues each Y event touches. Top-level events carry
	// whole-issue adds/deletes; nested events carry a field change whose path[0] is the id.
	#onChange = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>): void => {
		const upserted: Issue[] = [];
		const removed: string[] = [];
		for (const event of events) {
			if (event.path.length === 0) {
				for (const [key, change] of event.changes.keys) {
					if (change.action === 'delete') {
						this.#byId.delete(key);
						removed.push(key);
					} else {
						const yIssue = this.#map.get(key);
						if (yIssue) {
							const issue = readIssue(key, yIssue);
							this.#byId.set(key, issue);
							upserted.push(issue);
						}
					}
				}
			} else {
				const id = event.path[0];
				if (typeof id !== 'string') continue;
				const yIssue = this.#map.get(id);
				if (yIssue) {
					const issue = readIssue(id, yIssue);
					this.#byId.set(id, issue);
					upserted.push(issue);
				} else {
					this.#byId.delete(id);
					removed.push(id);
				}
			}
		}
		// One emit per observer batch, so a transaction touching many issues is one message.
		this.#emit({ upserted, removed, reset: false });
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
