// Who else is in the workspace, and what they are looking at.
//
// Awareness is the ephemeral half of Yjs: not part of the document, never persisted, and
// discarded when a socket closes. This module projects it into runes the same way
// `issues.svelte.ts` projects the CRDT, with one important addition — it owns liveness.
//
// Nothing else in this stack expires a stale peer. `y-protocols` ships a 30 s sweep, but
// y-partyserver clears its interval on both ends: `provider/index.js` does it in the client
// constructor and `server/index.js` does it in WSSharedDoc. A peer whose network vanishes
// without closing its socket would therefore be shown as present forever. On top of that,
// the relay's Durable Object hibernates (ADR 0002), and a woken instance has an empty
// awareness map, so its own removal-on-disconnect has nothing left to remove.
//
// The fix is a heartbeat plus a staleness filter, which repairs both: the beat re-populates
// a woken relay, and the filter hides anyone who has stopped beating.

import { browser } from '$app/environment';
import type { Awareness } from 'y-protocols/awareness';
import {
	IDENTITY_STORAGE_KEY,
	createIdentity,
	normaliseName,
	parseIdentity,
	seededRandom,
	type Identity
} from '$lib/model/identity.js';
import type { RemoteActivity } from './remote-activity.svelte.js';

/** How often a peer announces that it is still there, while anyone else is known. */
const HEARTBEAT_MS = 10_000;
/** Past this without a beat, a peer stops being shown. Two and a half missed beats. */
const STALE_MS = 25_000;
/**
 * Past this, a peer is dropped from the local awareness map altogether.
 *
 * Purely local bookkeeping: it is deliberately not `removeAwarenessStates`, because that
 * broadcasts the removal, and one client's bad connection would then evict a peer who is
 * perfectly healthy from everyone else's screen. Forgetting is also what lets the heartbeat
 * stop, which is what lets the Durable Object hibernate.
 */
const FORGET_MS = 120_000;
/** The single timer driving both the staleness filter and the beat. */
const TICK_MS = 5_000;

/** An issue id is compared and used as a map key, so its size is bounded on arrival. */
const MAX_ID_LENGTH = 64;

export interface Peer extends Identity {
	/** The issue this person currently has open, if any. */
	activeIssueId: string | null;
	/** How many tabs this person has open, which is why peers are keyed by user. */
	sessions: number;
}

/** What `y-protocols` passes to an awareness listener. */
interface AwarenessChange {
	added: number[];
	updated: number[];
	removed: number[];
}

/** The shape written to awareness. Every field of an inbound one is untrusted. */
interface PresenceState {
	userId: string;
	name: string;
	hue: number;
	issue: string | null;
	/** Changes on every beat, because the provider broadcasts on `change`, not `update`. */
	t: number;
}

const NO_PEERS: readonly Peer[] = [];

/** Reads the remembered identity, minting one on first visit. */
export function loadIdentity(): Identity {
	if (!browser) return createIdentity();
	try {
		const raw = localStorage.getItem(IDENTITY_STORAGE_KEY);
		if (!raw) {
			const minted = createIdentity();
			localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(minted));
			return minted;
		}
		return parseIdentity(JSON.parse(raw));
	} catch {
		// Blocked storage or corrupt JSON: a session-only identity still works.
		return createIdentity();
	}
}

function saveIdentity(identity: Identity): void {
	if (!browser) return;
	try {
		localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
	} catch {
		// Not remembering it only costs the name on the next reload.
	}
}

/**
 * Turns one inbound awareness state into a peer, or null if it is not one yet.
 *
 * Connected clients publish an empty state before they announce themselves, so an absent
 * name means "not ready", not "invalid". Anything that *is* there goes through
 * `parseIdentity`, which is the same validation the local identity gets: this data is
 * written by anyone holding the workspace link.
 *
 * Exported for the store, which names the author of a remote edit from the same awareness
 * state — and so must get the same validated hue an avatar would, never the raw field.
 */
export function toPeer(raw: unknown): Peer | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const state = raw as Partial<PresenceState>;
	if (typeof state.name !== 'string' || typeof state.userId !== 'string') return null;
	// Seeded from the user id so a peer with an unusable hue gets a stable replacement
	// rather than a new colour on every repaint.
	const identity = parseIdentity(state, seededRandom(state.userId));
	const issue =
		typeof state.issue === 'string' && state.issue.length > 0 && state.issue.length <= MAX_ID_LENGTH
			? state.issue
			: null;
	return { ...identity, activeIssueId: issue, sessions: 1 };
}

export class Presence {
	#awareness: Awareness;
	#timer: ReturnType<typeof setInterval> | null = null;
	#lastBeat = 0;
	/**
	 * When each remote client was last heard from, by this machine's clock.
	 *
	 * Deliberately not `awareness.meta.lastUpdated`, which would be the obvious choice: lib0
	 * captures `Date.now` by reference at module load (`lib0/time.js`), so that timestamp
	 * comes from a clock nothing else can see or control. Stamping arrivals here keeps
	 * liveness on one clock, and it is still a local stamp — a peer with a wrong system
	 * clock cannot make itself look permanently fresh or permanently stale.
	 */
	// Never read reactively — the projection below is what the UI sees — so a SvelteMap here
	// would add change tracking to bookkeeping nothing subscribes to.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#lastSeen = new Map<number, number>();

	/** This browser's own identity. Editable, remembered, and authorising nothing. */
	me = $state<Identity>(createIdentity());
	/** Everyone else, de-duplicated per person and stably ordered. */
	peers = $state<Peer[]>([]);

	#byIssue = $derived.by(() => {
		// Rebuilt whole on every change, so its contents never mutate in place and there is
		// nothing for a reactive Map to observe; the $derived is the reactivity.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const index = new Map<string, Peer[]>();
		for (const peer of this.peers) {
			if (!peer.activeIssueId) continue;
			const existing = index.get(peer.activeIssueId);
			if (existing) existing.push(peer);
			else index.set(peer.activeIssueId, [peer]);
		}
		return index;
	});

	#activeIssueId: string | null = null;

	/**
	 * What peers have just changed — the store's record, carried here so that anything holding
	 * presence can say so. The header's presence bar is mounted on every route and is handed
	 * only this object, which makes it the one place an announcer can live that is neither
	 * route-specific nor gone while the list is empty (the moment a peer adds the first issue
	 * is exactly the one most worth announcing). Null for a bare Presence in tests.
	 */
	readonly activity: RemoteActivity | null;

	constructor(
		awareness: Awareness,
		identity: Identity = loadIdentity(),
		activity: RemoteActivity | null = null
	) {
		this.#awareness = awareness;
		this.me = identity;
		this.activity = activity;
		// `update` rather than `change`: any message at all proves a peer is alive, including
		// a beat that happens to repeat what it said last time.
		this.#awareness.on('update', this.#onUpdate);
		this.#publish();
		this.#rebuild();
		if (browser) this.#timer = setInterval(this.#tick, TICK_MS);
	}

	/** Everyone in the workspace, this browser first. */
	get everyone(): Peer[] {
		// This browser's other tabs share its identity, so `peers` carries them under *my* user
		// id. Listed beside me they were the same person twice, and a keyed avatar list threw
		// `each_key_duplicate` — which halts every later update on the page, so the first tab
		// froze the moment the "Open a second window" invitation was taken up. They are folded
		// into me as extra sessions instead: one person, several tabs, exactly as for anyone
		// else. `peers` keeps them, because another window of this workspace is still the
		// second view the invitation asked for.
		const sessions = 1 + this.myOtherTabs;
		return [{ ...this.me, activeIssueId: this.#activeIssueId, sessions }, ...this.others];
	}

	/**
	 * Other *people*: `peers` without this browser's own other tabs. What anything that counts
	 * or names company reads — "Ada is also here" and "Shared with 1 other" said of your own
	 * second tab was a claim about a person who is not there.
	 */
	get others(): Peer[] {
		return this.peers.filter((peer) => peer.userId !== this.me.userId);
	}

	/** How many other tabs of this browser have the workspace open. */
	get myOtherTabs(): number {
		return this.peers.find((peer) => peer.userId === this.me.userId)?.sessions ?? 0;
	}

	/** The other people currently looking at `issueId`. */
	viewersOf(issueId: string): readonly Peer[] {
		return this.#byIssue.get(issueId) ?? NO_PEERS;
	}

	/** Records which issue this browser has open; null when it is looking at a list. */
	setActiveIssue(issueId: string | null): void {
		if (issueId === this.#activeIssueId) return;
		this.#activeIssueId = issueId;
		this.#publish();
	}

	/** Changes the display name, remembers it, and tells everyone. */
	rename(name: string): void {
		const next = { ...this.me, name: normaliseName(name, this.me.name) };
		if (next.name === this.me.name) return;
		this.me = next;
		saveIdentity(next);
		this.#publish();
	}

	destroy(): void {
		if (this.#timer !== null) clearInterval(this.#timer);
		this.#timer = null;
		this.#awareness.off('update', this.#onUpdate);
		// Tells everyone still connected that this tab has gone, rather than leaving them to
		// time it out. Harmless if the socket has already closed.
		this.#awareness.setLocalState(null);
	}

	#publish(): void {
		const state: PresenceState = {
			userId: this.me.userId,
			name: this.me.name,
			hue: this.me.hue,
			issue: this.#activeIssueId,
			t: Date.now()
		};
		this.#awareness.setLocalState(state);
		this.#lastBeat = state.t;
	}

	#onUpdate = ({ added, updated, removed }: AwarenessChange): void => {
		const now = Date.now();
		for (const clientId of [...added, ...updated]) {
			if (clientId !== this.#awareness.clientID) this.#lastSeen.set(clientId, now);
		}
		for (const clientId of removed) this.#lastSeen.delete(clientId);
		this.#rebuild(now);
	};

	/**
	 * Rebuilds the peer list from scratch on every change.
	 *
	 * `getStates()` hands back the awareness instance's own live Map, including this client,
	 * so it is copied rather than held, and the local id is filtered out.
	 */
	#rebuild(now: number = Date.now()): void {
		// A local accumulator, discarded at the end of this function.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const byUser = new Map<string, { peer: Peer; lastUpdated: number }>();
		for (const [clientId, raw] of this.#awareness.getStates()) {
			if (clientId === this.#awareness.clientID) continue;
			// A client seen for the first time counts as fresh. That is the state y-partyserver
			// pushes in bulk when a socket opens, which arrives with no update event of its own.
			let lastUpdated = this.#lastSeen.get(clientId);
			if (lastUpdated === undefined) {
				lastUpdated = now;
				this.#lastSeen.set(clientId, now);
			}
			if (now - lastUpdated > STALE_MS) continue;
			const peer = toPeer(raw);
			if (!peer) continue;
			const existing = byUser.get(peer.userId);
			if (!existing) {
				byUser.set(peer.userId, { peer, lastUpdated });
				continue;
			}
			// One person, several tabs: show them once, and let the freshest tab say which
			// issue they are on. Two tabs can easily be stamped in the same millisecond, so
			// the tie is broken towards the tab that has an issue open — otherwise which one
			// wins would depend on map iteration order.
			existing.peer.sessions += 1;
			const fresher =
				lastUpdated > existing.lastUpdated ||
				(lastUpdated === existing.lastUpdated &&
					peer.activeIssueId !== null &&
					existing.peer.activeIssueId === null);
			if (fresher) {
				existing.lastUpdated = lastUpdated;
				existing.peer = { ...peer, sessions: existing.peer.sessions };
			}
		}
		this.peers = [...byUser.values()]
			.map((entry) => entry.peer)
			.sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
	}

	#tick = (): void => {
		const now = Date.now();
		// Forget first, so the decision below sees an accurate picture of who is left.
		for (const [clientId] of [...this.#awareness.getStates()]) {
			if (clientId === this.#awareness.clientID) continue;
			if (now - (this.#lastSeen.get(clientId) ?? now) <= FORGET_MS) continue;
			this.#awareness.states.delete(clientId);
			this.#awareness.meta.delete(clientId);
			this.#lastSeen.delete(clientId);
		}
		this.#rebuild(now);

		// A tab on its own sends nothing at all, which is the whole point: an idle room has no
		// traffic, so the Durable Object hibernates and an idle workspace costs nothing.
		//
		// The gate is the raw map, not the visible peers, and that distinction is what stops a
		// deadlock: if two peers stop hearing each other for half a minute they both hide the
		// other, and if they also both stopped beating neither would ever find out the other
		// was alive. Beating while a hidden peer is still remembered means the first message
		// to get through restores both sides. After FORGET_MS the room really is empty, the
		// beat stops, and the relay hibernates.
		const alone = this.#awareness.getStates().size <= 1;
		if (!alone && now - this.#lastBeat >= HEARTBEAT_MS) this.#publish();
	};
}

let browserPresence: Presence | null = null;

/**
 * The shared presence bridge, on the workspace the store is bound to.
 *
 * A session singleton in the browser and a throwaway on the server, for the same reason
 * `getIssueStore` is: presence held across requests would leak one visitor's peers into
 * another's first render.
 */
export function getPresence(store: { awareness: Awareness; remote?: RemoteActivity }): Presence {
	const create = () => new Presence(store.awareness, undefined, store.remote ?? null);
	if (!browser) return create();
	if (!browserPresence) browserPresence = create();
	return browserPresence;
}

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		browserPresence?.destroy();
		browserPresence = null;
	});
}
