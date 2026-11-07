// The bridge from CRDT to Svelte reactivity: observes the issues Y.Map and maintains a
// reactive projection (SvelteMap of plain Issue snapshots). Yjs is the source of truth;
// this is a derived view recomputed incrementally from Y events. Writes go straight to
// the CRDT (src/lib/sync/issues) — the projection updates through the observer, so the
// UI never mutates local state directly.

import { browser } from '$app/environment';
import { SvelteMap } from 'svelte/reactivity';
import { online } from 'svelte/reactivity/window';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import {
	DEFAULT_WORKSPACE_ID,
	VISITED_STORAGE_KEY,
	WORKSPACE_STORAGE_KEY,
	workspaceDbName,
	chooseWorkspace,
	readVisited,
	rememberVisit,
	type WorkspaceResolution
} from '$lib/model/workspace.js';
import type { Issue, IssuePatch, IssueStatus, NewIssueInput } from '$lib/model/issue.js';
import {
	createDoc,
	createUndoManager,
	redoOneStep,
	undoOneStep,
	getIssuesMap,
	getYIssue,
	touchedEntries,
	type IssuesMap,
	type YIssue
} from '$lib/sync/doc.js';
import {
	createIssue,
	deleteIssue,
	moveIssue,
	patchIssue,
	readAllIssues,
	readIssue
} from '$lib/sync/issues.js';
import { seedIssues, seedDemoIssues, type SeedOptions } from '$lib/sync/seed.js';
import { attachPersistence, type WorkspacePersistence } from '$lib/sync/persistence.js';
import { attachRelay, type RelayConnection } from '$lib/sync/provider.js';
import type { PersistFailure, PersistenceState } from '$lib/sync/relay-notice.js';
import { ConnectionStatus, type ConnectionState } from '$lib/sync/connection.svelte.js';
import { RemoteActivity } from './remote-activity.svelte.js';
import { classifyChange, isLiveRemote, type RemoteAuthor } from './remote-change.js';
import { toPeer } from './presence.svelte.js';
import { PRESENCE_IDS_STORAGE_KEY } from '$lib/model/identity.js';

/** What changed in one CRDT batch. Emitted to listeners such as the search index. */
export interface IssueDelta {
	upserted: readonly Issue[];
	removed: readonly string[];
	/** True when the whole projection was rebuilt and listeners should start over. */
	reset: boolean;
}

/**
 * One run of writes that undo should take back as a single step — a burst of typing in a
 * field that commits as it goes. Opaque to callers: open one with `beginEdit`, pass it to
 * every `update` of the run, and hand it to `revertEdit` to cancel the run.
 */
export interface EditGroup {
	/** The undo stack item this run's writes are merged into, once the first one lands. */
	item: unknown;
}

/** Seams for tests; production passes nothing. */
export interface IssueStoreOptions {
	/**
	 * Replaces the relay. A browser-mode test has no socket, and the remote-change path is
	 * defined by the relay's origin and its `synced` signal, so the only honest way to test it
	 * is to hand the store a relay the test drives: a fake provider object as the origin, a
	 * real Awareness, and the handlers to report `synced` through.
	 */
	attachRelay?: typeof attachRelay;
}

/**
 * The workspace this session belongs to.
 *
 * Read once and remembered, so ordinary navigation and reloads stay put without every
 * internal link having to carry the id. The address bar still shows it: the root layout writes
 * this id back as `?ws=` after every navigation (`workspaceAddress`), so what the visitor can
 * copy is always this workspace's link. On the server there is no URL to read and the store
 * is empty anyway, so the sentinel is correct there.
 */
function sessionWorkspace(): WorkspaceSession {
	if (!browser) {
		return {
			id: DEFAULT_WORKSPACE_ID,
			invalidParam: null,
			leftBehind: null,
			newToBrowser: false,
			minted: false,
			visited: []
		};
	}
	let remembered: string | null = null;
	let stored: unknown = null;
	try {
		remembered = localStorage.getItem(WORKSPACE_STORAGE_KEY);
		stored = JSON.parse(localStorage.getItem(VISITED_STORAGE_KEY) ?? 'null');
	} catch {
		// Private mode, blocked storage, or a list someone mangled; the URL or a freshly minted
		// id still works.
	}
	const earlier = readVisited(stored);
	// Everything but the storage is `chooseWorkspace`'s: which id wins, and the fact that a
	// visitor with nothing usable gets a workspace of their own rather than landing in a
	// shared one. This function only remembers the answer.
	const session = chooseWorkspace(location.search, remembered, earlier);
	const visited = rememberVisit(earlier, session.id, remembered);
	try {
		// A link never replaces the remembered workspace, the one a bare address opens: only the
		// visitor does that (`adoptWorkspace`). It used to happen silently, so a link was enough to
		// send everything someone typed afterwards into whoever sent it.
		const adopt = session.id !== remembered && session.leftBehind === null;
		if (adopt) localStorage.setItem(WORKSPACE_STORAGE_KEY, session.id);
		localStorage.setItem(VISITED_STORAGE_KEY, JSON.stringify(visited));
	} catch {
		// Not being able to remember it only costs us the id on the next reload.
	}
	return { ...session, visited };
}

/** A {@link WorkspaceResolution} plus what this browser has opened, as now remembered. */
interface WorkspaceSession extends WorkspaceResolution {
	visited: readonly string[];
}

/** The channel `IssueStore.forget` announces itself on. */
const FORGET_CHANNEL = 'syncticket:forget';

export class IssueStore {
	#doc: Y.Doc;
	#map: IssuesMap;
	#undo: Y.UndoManager;
	#persistence: WorkspacePersistence;
	#relay: RelayConnection;
	// Not itself $state — ConnectionStatus holds its own runes and this store's `connection`
	// getter reads straight through to `displayed`, the same pattern `awareness` uses for
	// the relay connection.
	#status = new ConnectionStatus();
	#relaySynced = $state(false);
	#relayEverSynced = $state(false);
	/** Whether this session minted the workspace; see {@link WorkspaceResolution.minted}. */
	#minted = false;
	#byId = new SvelteMap<string, Issue>();
	/**
	 * What peers have just changed, for the rows and cards to trace and the announcer to say.
	 * Filled from the observer below, and only with changes that pass `isLiveRemote`.
	 */
	readonly remote = new RemoteActivity();
	/** Which workspace this store is bound to; the relay uses it as the room name. */
	readonly workspaceId: string;
	/**
	 * Whether this client has anything of its own to take back, or to reapply.
	 *
	 * Public and reactive so a control can be disabled rather than failing silently when the
	 * stack is empty. Mirrored from the UndoManager's events rather than recomputed, because
	 * `canUndo()` is a method on a non-reactive object and nothing would re-read it.
	 */
	canUndo = $state(false);
	canRedo = $state(false);
	// A plain array, not a Set: eslint's svelte/prefer-svelte-reactivity rejects a bare Set in
	// a .svelte.ts module, and this collection is never read reactively anyway.
	#listeners: Array<(delta: IssueDelta) => void> = [];
	#synced = $state(false);
	#persisted = $state(true);
	#invalidWorkspaceParam = $state<string | null>(null);
	#leftBehind = $state<string | null>(null);
	/**
	 * Where a tab says it has forgotten a workspace (`forget`), so this browser's other tabs of it
	 * stop: left running, they wrote on into a deleted database, and a reload recreated it.
	 */
	#forgetChannel: BroadcastChannel | null = null;
	/** Whether this is the workspace a bare address opens. See {@link linkQuery}. */
	#home = $state(true);
	/**
	 * The workspace this browser opened most recently before this one, or null. The way back
	 * after following someone's link: a bare address opens the last workspace opened, so
	 * without this a visitor's own issues could only be reached through browser history.
	 */
	readonly previousWorkspaceId: string | null;
	/** Whether a link brought this browser to this workspace for the first time. */
	readonly joinedNewWorkspace: boolean;
	/** Every workspace this browser has opened, most recent first, as of this session's start. */
	readonly visitedWorkspaceIds: readonly string[];
	// Relay storage health, as last reported by the relay itself. 'ok' until told otherwise:
	// a workspace with no relay, or one whose relay has not spoken yet, has no known storage
	// problem, and the UI must not imply one.
	//
	// Unlike `#invalidWorkspaceParam`, this is a *live* condition rather than a historical
	// fact. That one happened once, at load, and dismissing it is the end of it — hence a
	// field that is simply nulled. Relay storage can degrade, recover and degrade again
	// within a session, so dismissal here hides only the transition the visitor was shown:
	// `#acknowledgedPersistenceAt` remembers which one that was, and a later notice carries
	// a newer `at` and raises itself again.
	#relayPersistence = $state<PersistenceState>('ok');
	#relayPersistenceReason = $state<PersistFailure | undefined>(undefined);
	#relayPersistenceAt = $state(0);
	#acknowledgedPersistenceAt = $state(0);

	constructor(explicitWorkspaceId?: string, options: IssueStoreOptions = {}) {
		// An explicit id (tests, benchmarks) bypasses the URL and storage entirely, so there is
		// no share link for it to have been wrong about.
		const session: WorkspaceSession =
			explicitWorkspaceId === undefined
				? sessionWorkspace()
				: {
						id: explicitWorkspaceId,
						invalidParam: null,
						leftBehind: null,
						newToBrowser: false,
						minted: false,
						visited: []
					};
		const workspaceId = session.id;
		this.workspaceId = workspaceId;
		this.#minted = session.minted;
		this.#invalidWorkspaceParam = session.invalidParam;
		this.#leftBehind = session.leftBehind;
		this.#home = session.leftBehind === null;
		if (browser && typeof BroadcastChannel !== 'undefined') {
			this.#forgetChannel = new BroadcastChannel(FORGET_CHANNEL);
			this.#forgetChannel.onmessage = (event: MessageEvent) => {
				if ((event.data as { workspaceId?: unknown } | null)?.workspaceId !== workspaceId) return;
				this.destroy();
				location.assign('/issues');
			};
		}
		this.joinedNewWorkspace = session.newToBrowser;
		this.visitedWorkspaceIds = session.visited;
		this.previousWorkspaceId = session.visited.find((id) => id !== workspaceId) ?? null;
		this.#doc = createDoc();
		this.#map = getIssuesMap(this.#doc);
		this.#map.observeDeep(this.#onChange);
		// Undo, scoped to this client's own edits and nobody else's.
		//
		// The scoping is the whole point: every write this store makes goes through `#write`, with
		// the store as its origin, and only that origin is tracked. IndexedDB and the relay apply
		// with their provider as the origin, and Yjs's own tidying up has none, so ⌘Z takes back what
		// you did and can never take back what a peer did, which in a shared workspace with no
		// accounts is the difference between an undo and an attack. It is also why undo survives a
		// merge: the stack holds this client's changes, and Yjs re-applies the inverse against
		// whatever the document has become.
		this.#undo = createUndoManager(this.#map, this);
		this.#undo.on('stack-item-added', this.#syncUndoState);
		this.#undo.on('stack-item-popped', this.#syncUndoState);
		this.#undo.on('stack-cleared', this.#syncUndoState);
		this.#persistence = attachPersistence(this.#doc, workspaceId);
		// Attached synchronously, like persistence: a provider that arrives late misses the
		// updates made in the gap. A remote update arriving before IndexedDB has finished
		// loading is safe, because the post-load rebuild re-reads the whole Y.Map.
		this.#relay = (options.attachRelay ?? attachRelay)(this.#doc, workspaceId, {
			onConnection: (state) => this.#status.report(state),
			onOffline: () => this.#status.reportCertainOffline(),
			onNetworkBack: () => this.#status.reportNetworkBack(),
			onSynced: (synced) => {
				this.#relaySynced = synced;
				// Latched apart from the live flag, which a later reconnect drops back to false:
				// "this client has never heard what is in this workspace" is a question that can
				// only be answered once, and `settled` below must not un-answer it.
				if (synced) this.#relayEverSynced = true;
			},
			onPersistence: (notice) => {
				this.#relayPersistence = notice.state;
				this.#relayPersistenceReason = notice.reason;
				this.#relayPersistenceAt = notice.at;
			}
		});
		void this.#persistence.whenSynced.then(
			// Nothing a peer can write makes this rebuild throw, but if anything ever does, the
			// visitor must still come off the loading skeleton: they have no way out of it.
			() => {
				try {
					this.#reindex();
				} catch (error) {
					console.error('[issues] rebuilding after the local load failed', error);
				}
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

	/**
	 * The unusable `?ws=` value this session arrived with, or null.
	 *
	 * Attacker-supplied text — whatever was in the link — so a UI showing it must render it
	 * as text and bound its length. Cleared by {@link dismissInvalidWorkspaceParam} once the
	 * visitor has been told, which is what keeps it a one-time notice rather than a fixture
	 * of every visit to the list for the rest of the session.
	 */
	get invalidWorkspaceParam(): string | null {
		return this.#invalidWorkspaceParam;
	}

	/** Acknowledges the notice above. */
	dismissInvalidWorkspaceParam(): void {
		this.#invalidWorkspaceParam = null;
	}

	/**
	 * The workspace a link just took this browser away from, while the notice saying so is up;
	 * see {@link WorkspaceResolution.leftBehind}.
	 */
	get leftBehindWorkspaceId(): string | null {
		return this.#leftBehind;
	}

	/** Acknowledges the notice above, keeping the previous workspace as the remembered one. */
	dismissLeftBehind(): void {
		this.#leftBehind = null;
	}

	/** Makes this workspace the one a bare address opens, and acknowledges the notice above. */
	adoptWorkspace(): void {
		try {
			localStorage.setItem(WORKSPACE_STORAGE_KEY, this.workspaceId);
		} catch {
			// Blocked storage: nothing is remembered anyway.
		}
		this.#leftBehind = null;
		this.#home = true;
	}

	/**
	 * What an internal link's address needs after its path to stay in this workspace: `?ws=` and
	 * the id when this is not the workspace a bare address opens, else nothing.
	 *
	 * Links inside the app carry no `?ws=`, because the session already knows its workspace. A new
	 * tab does not: it starts from the address alone, and a bare one opens the remembered
	 * workspace. So an issue opened in a new tab from someone's shared workspace landed in the
	 * visitor's own, as "Issue not found".
	 */
	get linkQuery(): string {
		return this.#home ? '' : `?ws=${encodeURIComponent(this.workspaceId)}`;
	}

	/**
	 * Whether the relay can still store this workspace.
	 *
	 * 'ok' covers both "storing normally" and "no relay to store it", which are the same
	 * thing from here: nothing is wrong with the relay's storage. The data is not at risk in
	 * either case beyond what {@link persisted} already reports.
	 */
	get relayPersistence(): PersistenceState {
		return this.#relayPersistence;
	}

	/** Why the relay's last save failed, when it did. Undefined while `relayPersistence` is 'ok'. */
	get relayPersistenceReason(): PersistFailure | undefined {
		return this.#relayPersistenceReason;
	}

	/**
	 * Whether the visitor should currently be shown the relay-storage notice.
	 *
	 * Not simply `relayPersistence !== 'ok'`: that would make a dismissal either permanent
	 * (and hide a *later*, different failure) or useless (re-raising the same one on the next
	 * render). Comparing timestamps dismisses exactly one transition, which is what the
	 * notice's `at` is for.
	 */
	get relayPersistenceNoticeVisible(): boolean {
		return (
			this.#relayPersistence !== 'ok' && this.#relayPersistenceAt > this.#acknowledgedPersistenceAt
		);
	}

	/** Dismisses the notice above until the relay reports a newer change in storage health. */
	acknowledgeRelayPersistence(): void {
		this.#acknowledgedPersistenceAt = this.#relayPersistenceAt;
	}

	/** True once the local load has completed (immediately when there's no persistence). */
	get synced(): boolean {
		return this.#synced;
	}

	/**
	 * True once this workspace's contents are everything they are going to be until someone
	 * types: the local database has loaded, *and* either the relay has sent its state or
	 * there is no relay left to hear from.
	 *
	 * `synced` is only the local half of that, and it flips within milliseconds on an empty
	 * IndexedDB — so someone opening a share link looks, by that measure alone, exactly like
	 * someone whose workspace is genuinely empty, for as long as the relay round trip takes.
	 * Anything that would tell a visitor their workspace is empty, or offer to fill it, has
	 * to wait for this instead: seeding a workspace that is still arriving writes into
	 * somebody else's data, and a CRDT has no undo for that.
	 */
	get settled(): boolean {
		if (!this.#synced) return false;
		if (this.#relayEverSynced) return true;
		const connection = this.#status.displayed;
		// 'local' means no relay is configured at all: a final answer. 'offline' is final only
		// for a workspace this session minted, which nobody can have shared anything into. For
		// one that came from a link (or from storage) the relay may well hold its issues, and
		// an invitee whose relay was down or blocked used to be offered examples that merged
		// into the real workspace once it came back. A CRDT can't take that back.
		return connection === 'local' || (connection === 'offline' && this.#minted);
	}

	/**
	 * True while the relay can't be reached although the browser reports a network, for a
	 * workspace that may hold shared issues and has never heard from it. The relay is down,
	 * or a proxy or firewall blocks it, so anything shared with this link has not arrived.
	 */
	get relayUnreachable(): boolean {
		return (
			!this.#minted &&
			!this.#relayEverSynced &&
			this.#status.displayed === 'offline' &&
			online.current === true
		);
	}

	get all(): Issue[] {
		return [...this.#byId.values()];
	}

	get(id: string): Issue | undefined {
		return this.#byId.get(id);
	}

	/**
	 * Takes back this client's last change. Never a peer's — see the constructor.
	 *
	 * Returns false when there is nothing to undo, so a caller can decide whether the
	 * keystroke was handled rather than swallowing every ⌘Z the document did not use.
	 */
	undo(): boolean {
		if (!this.#undo.canUndo()) return false;
		undoOneStep(this.#undo);
		this.#syncUndoState();
		return true;
	}

	/** Reapplies what {@link undo} took back. */
	redo(): boolean {
		if (!this.#undo.canRedo()) return false;
		redoOneStep(this.#undo);
		this.#syncUndoState();
		return true;
	}

	create(input?: NewIssueInput): string {
		return this.#write(() => createIssue(this.#map, input));
	}

	/**
	 * Writes a patch. With a `group`, the write joins that run's single undo step.
	 *
	 * The UndoManager groups by time — writes less than `captureTimeout` apart merge — which is
	 * exactly wrong for a field that commits after 400ms of idle typing: every pause longer
	 * than 300ms would become its own step, and ⌘Z after typing a sentence would take back one
	 * word. So a grouped write merges by *identity* instead. If the run's own item is still on
	 * top of the stack, `lastChange` is forced so Yjs appends to it whatever the clock says
	 * (Infinity rather than a timestamp, because lib0 captured `Date.now` at module load and
	 * a test's fake clock is not the one it reads). Otherwise the run starts a fresh item
	 * rather than leaking into whatever unrelated change happened to come just before.
	 *
	 * `stopCapturing` afterwards either way, so the merge window never outlives the write:
	 * a status change made just after a typed title stays a step of its own, and a no-op
	 * write (patchIssue drops unchanged fields, so there may be no transaction at all) cannot
	 * leave the forced value behind for the next unrelated change to fall into.
	 */
	update(id: string, patch: IssuePatch, group?: EditGroup): void {
		if (!group) {
			this.#write(() => patchIssue(this.#map, id, patch));
			return;
		}
		const top = this.#undo.undoStack.at(-1);
		if (group.item !== null && top === group.item) this.#undo.lastChange = Infinity;
		else this.#undo.stopCapturing();
		this.#write(() => patchIssue(this.#map, id, patch));
		const after = this.#undo.undoStack.at(-1);
		if (after !== undefined && after !== top) group.item = after;
		this.#undo.stopCapturing();
	}

	/** Opens a run of writes that undo treats as one step. See {@link update}. */
	beginEdit(): EditGroup {
		return { item: null };
	}

	/**
	 * Takes back everything a run wrote, restoring each field to what it was when the run
	 * began. Returns false when that is not possible from here — the run's item is no longer
	 * on top of the stack, because something else was done since — and the caller then has
	 * to write the original value back itself.
	 *
	 * Done through the UndoManager rather than by writing the old value, so the revert is
	 * not itself a new undo step, and ⌘⇧Z brings back what Escape discarded.
	 */
	revertEdit(group: EditGroup): boolean {
		if (group.item === null) return true;
		if (this.#undo.undoStack.at(-1) !== group.item) return false;
		undoOneStep(this.#undo);
		this.#syncUndoState();
		group.item = null;
		return true;
	}

	remove(id: string): void {
		this.#write(() => deleteIssue(this.#map, id));
	}

	/**
	 * Board drop: put `id` into `status` at the position implied by `orderedIds` (the target
	 * column's ids in their new display order, including `id`). Key maths lives in sync/.
	 */
	move(id: string, status: IssueStatus, orderedIds: readonly string[]): void {
		this.#write(() => moveIssue(this.#map, id, status, orderedIds));
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
		// Isolated because this runs inside a Yjs observer: a throw would escape into whichever
		// provider applied the update, and cost the listeners after it and the batch's remote
		// changes.
		for (const listener of this.#listeners) {
			try {
				listener(delta);
			} catch (error) {
				console.error('[issues] a change listener threw', error);
			}
		}
	}

	/** Bulk-appends generated issues in one transaction, for benchmarking at scale. */
	seed(count: number, options?: SeedOptions): string[] {
		return this.#write(() => seedIssues(this.#map, count, options));
	}

	/** Appends a small curated backlog. Called only from the empty state's own button. */
	seedDemo(): string[] {
		return this.#write(() => seedDemoIssues(this.#map));
	}

	/**
	 * Removes this workspace from this device: its local database, and every mention of it in
	 * this browser's memory of workspaces. The store is unusable afterwards, so the caller moves
	 * the page on. Returns the workspace to go to instead, if this browser has one.
	 *
	 * Anyone else with the link keeps their own copy, and the relay's copy expires on its own
	 * (`workers/relay/src/expiry.ts`). There is no deleting it for everyone: nobody owns a
	 * workspace, so nobody could be allowed to (ADR 0004).
	 */
	async forget(): Promise<string | null> {
		const id = this.workspaceId;
		const next = this.previousWorkspaceId;
		try {
			const visited = JSON.parse(localStorage.getItem(VISITED_STORAGE_KEY) ?? '[]');
			const kept = readVisited(visited).filter((other) => other !== id);
			localStorage.setItem(VISITED_STORAGE_KEY, JSON.stringify(kept));
			if (localStorage.getItem(WORKSPACE_STORAGE_KEY) === id) {
				if (next === null) localStorage.removeItem(WORKSPACE_STORAGE_KEY);
				else localStorage.setItem(WORKSPACE_STORAGE_KEY, next);
			}
			const presenceIds = JSON.parse(localStorage.getItem(PRESENCE_IDS_STORAGE_KEY) ?? '{}');
			if (presenceIds && typeof presenceIds === 'object') {
				delete (presenceIds as Record<string, unknown>)[id];
				localStorage.setItem(PRESENCE_IDS_STORAGE_KEY, JSON.stringify(presenceIds));
			}
		} catch {
			// Blocked or mangled storage: the database below is what holds the issues.
		}
		// Before the database goes, so the other tabs have closed theirs.
		this.#forgetChannel?.postMessage({ workspaceId: id });
		this.destroy();
		await this.#persistenceClosed;
		await new Promise<void>((resolve) => {
			const request = indexedDB.deleteDatabase(workspaceDbName(id));
			request.onsuccess = request.onerror = request.onblocked = () => resolve();
		});
		return next;
	}

	destroy(): void {
		this.#forgetChannel?.close();
		this.#forgetChannel = null;
		this.#map.unobserveDeep(this.#onChange);
		this.#undo.destroy();
		this.remote.destroy();
		// The relay goes first: it does not detach itself on doc.destroy(), so a socket left
		// open would apply an inbound sync message to a destroyed document.
		this.#relay.destroy();
		this.#status.destroy();
		this.#persistenceClosed = this.#persistence.destroy();
		this.#doc.destroy();
	}

	/** Settles once the local database has been closed, which `forget` waits for. */
	#persistenceClosed: Promise<void> = Promise.resolve();

	#syncUndoState = () => {
		this.canUndo = this.#undo.canUndo();
		this.canRedo = this.#undo.canRedo();
	};

	/** A write of this visitor's, which is what undo tracks. See the constructor. */
	#write<T>(write: () => T): T {
		return this.#doc.transact(write, this);
	}

	/** Full idempotent resync of the projection from the CRDT (runs once, post-load). */
	#reindex(): void {
		const issues = readAllIssues(this.#map);
		this.#byId.clear();
		for (const issue of issues) this.#byId.set(issue.id, issue);
		this.#emit({ upserted: issues, removed: [], reset: true });
	}

	// Incrementally patches only the issues each Y event touches. Top-level events carry
	// whole-issue adds/deletes; nested events carry a field change somewhere under an issue.
	//
	// It is also where a peer's change is recognised, because only here are the issue's
	// before and after both in hand: `before` is read from the projection before it is
	// overwritten, which is the cheapest correct "what was it" there is.
	#onChange = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>): void => {
		const upserted: Issue[] = [];
		const removed: string[] = [];
		const transaction = events[0]?.transaction;
		const live = transaction !== undefined && this.#isLiveRemote(transaction);
		const changes: Array<{ before: Issue | undefined; after: Issue | undefined; client?: number }> =
			[];
		// Brings one id's row in line with the document, whatever the event was. Asking what the
		// entry is now, rather than going by `change.action`, is what covers an issue replaced by
		// junk: that is an 'update' to the map, but a removal to everyone reading it. An entry
		// that was not an issue before and is not one now has no row, so it reaches nobody.
		const project = (id: string, client: (yIssue: YIssue) => number | undefined): void => {
			const before = this.#byId.get(id);
			const yIssue = getYIssue(this.#map, id);
			if (!yIssue) {
				if (!this.#byId.delete(id)) return;
				removed.push(id);
				if (live) changes.push({ before, after: undefined });
				return;
			}
			const issue = readIssue(id, yIssue);
			this.#byId.set(id, issue);
			upserted.push(issue);
			if (live) changes.push({ before, after: issue, client: client(yIssue) });
		};
		// Once per entry however many events touched it, so one update touching every level of a
		// deep chain doesn't read the issue once for each. A second pass could only have found the
		// row already up to date. An edit inside a Y.Text or Y.Array stored as junk lands here too,
		// naming the junk entry.
		for (const { id, event } of touchedEntries(this.#map, events)) {
			if (event.target === this.#map) {
				project(id, () => authorClient(this.#map, id));
			} else {
				project(id, (yIssue) => {
					const key = event.changes.keys.keys().next().value;
					return key === undefined ? undefined : authorClient(yIssue, key);
				});
			}
		}
		// One emit per observer batch, so a transaction touching many issues is one message.
		this.#emit({ upserted, removed, reset: false });
		// After the projection, so a row the trace is drawn on already shows the new value.
		const at = Date.now();
		for (const { before, after, client } of changes) {
			const kind = classifyChange(before, after);
			const issue = after ?? before;
			if (!kind || !issue) continue;
			this.remote.record({
				issueId: issue.id,
				kind,
				title: issue.title,
				status: issue.status,
				author: client === undefined ? null : this.#authorOf(client),
				at
			});
		}
	};

	#isLiveRemote(transaction: Y.Transaction): boolean {
		const provider = this.#relay.provider;
		return isLiveRemote({
			local: transaction.local,
			fromRelay: provider !== null && transaction.origin === provider,
			relaySynced: this.#relaySynced,
			loaded: this.#synced
		});
	}

	/**
	 * Names the person behind a Yjs client id.
	 *
	 * A Y.Doc and the Awareness built on it share one client id (`new Awareness(doc)` takes
	 * `doc.clientID`), so the peer who wrote an item is the awareness state under that id.
	 * Read through presence's own validation, so the hue is the checked number an avatar
	 * would get. A writer whose awareness has not arrived yet, or has already gone, is null.
	 */
	#authorOf(client: number): RemoteAuthor | null {
		const peer = toPeer(this.#relay.awareness.getStates().get(client));
		return peer ? { userId: peer.userId, name: peer.name, hue: peer.hue } : null;
	}
}

/**
 * The Yjs client that wrote `key` on `map` most recently.
 *
 * A Y.Map set inserts a new item and deletes the old one, so the live item's id is the
 * writer's (client, clock) — per key, which is more precise than diffing the transaction's
 * state vectors: one relay update can carry several peers' edits, and this attributes each
 * issue to the peer who actually touched it. `_map` is internal by name but public in
 * Yjs's typings, and it is the only place the item is reachable from.
 */
function authorClient(map: { _map: Map<string, Y.Item> }, key: string): number | undefined {
	return map._map.get(key)?.id.client;
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
