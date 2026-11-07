// Phase 10 acceptance: presence appears, and it goes away.
//
// This is where the acceptance criterion ("disconnects clear presence within seconds")
// actually lives. The e2e can only close a browser context, which produces either a clean
// close or a socket error depending on timing, and cannot produce the case that matters
// most — a peer that stops talking without closing anything. Here both paths are driven
// directly, with two Awareness instances relayed by hand so the transport can be cut.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
	Awareness,
	applyAwarenessUpdate,
	encodeAwarenessUpdate,
	removeAwarenessStates
} from 'y-protocols/awareness';
import { Presence } from './presence.svelte.js';
import { createIdentity, type Identity } from '$lib/model/identity.js';

interface Node {
	awareness: Awareness;
	presence: Presence;
	identity: Identity;
}

interface AwarenessChange {
	added: number[];
	updated: number[];
	removed: number[];
}

const nodes: Node[] = [];
const extras: Awareness[] = [];
/** Flipped to false to simulate a peer that vanishes without closing its socket. */
let linked = true;

/** An Awareness with the protocol's own sweep disabled, exactly as y-partyserver ships it. */
function makeAwareness(): Awareness {
	const awareness = new Awareness(new Y.Doc());
	// Without this the 30 s sweep would run here and not in production, and the test would be
	// proving the behaviour of a stack we do not ship.
	clearInterval(awareness._checkInterval);
	return awareness;
}

function makeNode(name: string, identity?: Identity): Node {
	const awareness = makeAwareness();
	const id: Identity = identity ?? { ...createIdentity(), name };
	const node: Node = { awareness, presence: new Presence(awareness, id), identity: id };
	nodes.push(node);
	return node;
}

/** The forwarder attached to each node, kept so `connect` stays idempotent. */
const relays = new Map<Awareness, (changes: AwarenessChange) => void>();

/** Wires every node to every other, the way a relay would, while `linked` is true. */
function connect(): void {
	for (const node of nodes) {
		if (relays.has(node.awareness)) continue;
		const forward = ({ added, updated, removed }: AwarenessChange) => {
			if (!linked) return;
			const update = encodeAwarenessUpdate(node.awareness, [...added, ...updated, ...removed]);
			for (const other of nodes) {
				if (other.awareness !== node.awareness) {
					applyAwarenessUpdate(other.awareness, update, 'remote');
				}
			}
		};
		relays.set(node.awareness, forward);
		node.awareness.on('update', forward);
	}
	// Everyone already present announces themselves to whoever just joined.
	for (const node of nodes) {
		for (const other of nodes) {
			if (other.awareness !== node.awareness) deliver(node.awareness, other.awareness);
		}
	}
}

/** Hand-delivers one awareness state into a node, for peers that are not full nodes. */
function deliver(from: Awareness, to: Awareness): void {
	applyAwarenessUpdate(to, encodeAwarenessUpdate(from, [from.clientID]), 'remote');
}

beforeEach(() => {
	vi.useFakeTimers();
	linked = true;
});

afterEach(() => {
	while (nodes.length) nodes.pop()?.presence.destroy();
	while (extras.length) extras.pop()?.destroy();
	relays.clear();
	vi.useRealTimers();
});

describe('Presence', () => {
	it('shows the other person and not yourself', () => {
		const alice = makeNode('Ada Lovelace');
		const bob = makeNode('Grace Hopper');
		connect();
		alice.presence.rename('Ada Lovelace II');

		expect(bob.presence.peers.map((p) => p.name)).toEqual(['Ada Lovelace II']);
		expect(alice.presence.peers.map((p) => p.name)).toEqual(['Grace Hopper']);
		// Nobody is their own peer, and `everyone` puts this browser first.
		expect(bob.presence.peers.map((p) => p.userId)).not.toContain(bob.identity.userId);
		expect(bob.presence.everyone.map((p) => p.name)).toEqual(['Grace Hopper', 'Ada Lovelace II']);
	});

	it('clears presence immediately when a peer leaves cleanly', () => {
		const alice = makeNode('Ada Lovelace');
		const bob = makeNode('Grace Hopper');
		connect();
		alice.presence.rename('Ada L');
		expect(bob.presence.peers).toHaveLength(1);

		alice.presence.destroy();
		nodes.splice(nodes.indexOf(alice), 1);

		expect(bob.presence.peers).toHaveLength(0);
	});

	it('clears presence within seconds when a peer stops talking without disconnecting', () => {
		const alice = makeNode('Ada Lovelace');
		const bob = makeNode('Grace Hopper');
		connect();
		alice.presence.rename('Ada L');
		expect(bob.presence.peers).toHaveLength(1);

		// The case nothing else in this stack handles: the socket is still open as far as both
		// ends know, and no close event will ever arrive.
		linked = false;
		vi.advanceTimersByTime(30_000);

		expect(bob.presence.peers).toHaveLength(0);

		// And Ada comes back on her own once her messages flow again — no reload, no reconnect.
		// Both sides had hidden the other, and both kept beating anyway, which is the only
		// reason either of them finds out.
		linked = true;
		vi.advanceTimersByTime(15_000);
		expect(bob.presence.peers.map((p) => p.name)).toEqual(['Ada L']);
	});

	it('beats while anyone else is known, and falls silent when truly alone', () => {
		const alice = makeNode('Ada Lovelace');
		// Only outbound traffic counts: this is the hibernation argument, so what matters is
		// what alice sends, not what she hears.
		const sent = vi.fn();
		alice.awareness.on('update', (_changes: unknown, origin: unknown) => {
			if (origin === 'local') sent();
		});

		// Alone: nothing at all on the wire, so an idle room lets the relay hibernate.
		vi.advanceTimersByTime(120_000);
		expect(sent).not.toHaveBeenCalled();

		makeNode('Grace Hopper');
		connect();
		sent.mockClear();
		vi.advanceTimersByTime(31_000);
		// One beat every ten seconds, not one per five-second tick.
		expect(sent.mock.calls.length).toBeGreaterThanOrEqual(3);
		expect(sent.mock.calls.length).toBeLessThanOrEqual(4);
	});

	it('stops beating again once a vanished peer has been forgotten', () => {
		const alice = makeNode('Ada Lovelace');
		makeNode('Grace Hopper');
		connect();
		const sent = vi.fn();
		alice.awareness.on('update', (_changes: unknown, origin: unknown) => {
			if (origin === 'local') sent();
		});

		// Grace's connection dies without closing. Alice keeps beating for a while, because
		// that is what lets the two of them find each other again.
		linked = false;
		vi.advanceTimersByTime(60_000);
		expect(sent.mock.calls.length).toBeGreaterThan(0);

		// Once Grace is forgotten entirely, the room is empty and the traffic stops.
		vi.advanceTimersByTime(70_000);
		sent.mockClear();
		vi.advanceTimersByTime(60_000);
		expect(sent).not.toHaveBeenCalled();
	});

	it('counts one person once, however many tabs they have open', () => {
		const alice = makeNode('Ada Lovelace');
		const bob = makeNode('Grace Hopper');
		// A second tab: same identity, different Yjs client id.
		const twin = makeNode('Ada Lovelace', alice.identity);
		connect();
		twin.presence.setActiveIssue('issue-2');

		const seen = bob.presence.peers;
		expect(seen).toHaveLength(1);
		expect(seen[0]?.sessions).toBe(2);
		// The freshest tab says which issue they are on.
		expect(seen[0]?.activeIssueId).toBe('issue-2');
	});

	it("lists this browser's own other tab as more of me, never as a second me", () => {
		// The regression: a same-browser second window put this user's id into `everyone`
		// twice, the keyed avatar list threw each_key_duplicate, and the first tab stopped
		// updating altogether.
		const alice = makeNode('Ada Lovelace');
		const twin = makeNode('Ada Lovelace', alice.identity);
		makeNode('Grace Hopper');
		connect();

		const everyone = alice.presence.everyone;
		const ids = everyone.map((p) => p.userId);
		expect(new Set(ids).size).toBe(ids.length);
		expect(everyone.map((p) => [p.name, p.sessions])).toEqual([
			['Ada Lovelace', 2],
			['Grace Hopper', 1]
		]);
		// Still another window of the workspace, which is what the invitation waits for.
		expect(alice.presence.peers.map((p) => p.userId)).toContain(alice.identity.userId);
		expect(twin.presence.everyone[0]?.sessions).toBe(2);
	});

	it('counts other people, not my own other tabs', () => {
		// What the header label and "Shared with N" read: a second tab of mine is not company.
		const alice = makeNode('Ada Lovelace');
		makeNode('Ada Lovelace', alice.identity);
		connect();
		expect(alice.presence.others).toEqual([]);
		expect(alice.presence.myOtherTabs).toBe(1);

		makeNode('Grace Hopper');
		connect();
		expect(alice.presence.others.map((p) => p.name)).toEqual(['Grace Hopper']);
		expect(alice.presence.myOtherTabs).toBe(1);
	});

	it('indexes who is viewing which issue', () => {
		const alice = makeNode('Ada Lovelace');
		const bob = makeNode('Grace Hopper');
		connect();
		alice.presence.setActiveIssue('issue-1');

		expect(bob.presence.viewersOf('issue-1').map((p) => p.name)).toEqual(['Ada Lovelace']);
		expect(bob.presence.viewersOf('issue-2')).toHaveLength(0);

		alice.presence.setActiveIssue(null);
		expect(bob.presence.viewersOf('issue-1')).toHaveLength(0);
	});

	it('sanitises what a peer claims about itself', () => {
		const bob = makeNode('Grace Hopper');
		const hostile = makeAwareness();
		extras.push(hostile);
		hostile.setLocalState({
			userId: `u${'a'.repeat(32)}`,
			// U+202E reverses the text rendered after it, and the padding would push the name
			// out of the column it belongs in. Written as an escape so this file does not
			// itself contain a character that reorders the code around it.
			name: `Ada\u202Ereversed${' '.repeat(40)}and more`,
			hue: 'oklch(50% 0.2 20); background-image: url(https://tracker.example/beacon)',
			issue: 'x'.repeat(500),
			t: Date.now()
		});
		deliver(hostile, bob.awareness);

		const peer = bob.presence.peers[0];
		expect(peer?.name).toBe('Adareversed and more');
		expect(peer?.name.length).toBeLessThanOrEqual(32);
		// A hue is a number the UI puts inside oklch(). A string would have been a CSS
		// injection with a network beacon on the end of it.
		expect(typeof peer?.hue).toBe('number');
		expect(peer?.hue).toBeGreaterThanOrEqual(0);
		expect(peer?.hue).toBeLessThan(360);
		// An overlong issue id is dropped rather than used as a map key.
		expect(peer?.activeIssueId).toBeNull();
	});

	it('ignores a connected client that has not announced itself yet', () => {
		const bob = makeNode('Grace Hopper');
		const silent = makeAwareness();
		extras.push(silent);
		// Every connected tab publishes an empty state before it says who it is.
		silent.setLocalState({});
		deliver(silent, bob.awareness);

		expect(bob.presence.peers).toHaveLength(0);
	});

	it('gives a peer with an unusable hue the same replacement every time', () => {
		const bob = makeNode('Grace Hopper');
		const odd = makeAwareness();
		extras.push(odd);
		const base = { userId: `u${'b'.repeat(32)}`, name: 'Odd Peer', hue: Number.NaN, issue: null };
		odd.setLocalState({ ...base, t: Date.now() });
		deliver(odd, bob.awareness);
		const first = bob.presence.peers[0]?.hue;
		expect(typeof first).toBe('number');

		odd.setLocalState({ ...base, t: Date.now() + 1 });
		deliver(odd, bob.awareness);
		expect(bob.presence.peers[0]?.hue).toBe(first);
	});
});

describe('Presence after a reconnect', () => {
	/** Lets the answers, which are published after the handler that decided on them, go out. */
	const settle = async () => {
		for (let i = 0; i < 10; i++) await Promise.resolve();
	};

	/**
	 * What a dropped socket does to both ends: the provider removes every remote state on
	 * Ada's side, and the relay tells Grace that Ada has gone.
	 */
	function dropAda(ada: Node, grace: Node, { relayNoticed }: { relayNoticed: boolean }) {
		linked = false;
		removeAwarenessStates(ada.awareness, [grace.awareness.clientID], 'connection');
		if (relayNoticed) removeAwarenessStates(grace.awareness, [ada.awareness.clientID], 'remote');
	}

	/** What the provider does as the socket opens again: resend this tab's current state. */
	function reopenAda(ada: Node) {
		linked = true;
		ada.awareness.setLocalState(ada.awareness.getLocalState());
	}

	it('sees a peer again at once, not on their next beat, after the relay forgot both', async () => {
		const ada = makeNode('Ada Lovelace');
		const grace = makeNode('Grace Hopper');
		connect();
		await settle();
		expect(ada.presence.others.map((p) => p.name)).toEqual(['Grace Hopper']);

		dropAda(ada, grace, { relayNoticed: true });
		await settle();
		// Grace has been alone long enough to stop beating, and the relay hibernated meanwhile,
		// so it has no state of hers to hand Ada when she reconnects.
		vi.advanceTimersByTime(30_000);
		await settle();
		expect(ada.presence.others).toHaveLength(0);

		reopenAda(ada);
		await settle();
		// Before this fix: up to five seconds, until Grace's next tick.
		expect(ada.presence.others.map((p) => p.name)).toEqual(['Grace Hopper']);
		expect(grace.presence.others.map((p) => p.name)).toEqual(['Ada Lovelace']);
	});

	it('is answered at once too when the relay never told the peer we had gone', async () => {
		const ada = makeNode('Ada Lovelace');
		const grace = makeNode('Grace Hopper');
		connect();
		await settle();

		// Grace still has Ada, so Ada's return is an update to her, not someone new. It is
		// Ada's own state saying she can see no one that asks for the answer.
		dropAda(ada, grace, { relayNoticed: false });
		await settle();
		vi.advanceTimersByTime(2_000);

		reopenAda(ada);
		await settle();
		expect(ada.presence.others.map((p) => p.name)).toEqual(['Grace Hopper']);
	});

	it('answers once, and the answer does not start a conversation', async () => {
		const ada = makeNode('Ada Lovelace');
		const grace = makeNode('Grace Hopper');
		connect();
		await settle();
		dropAda(ada, grace, { relayNoticed: true });
		await settle();
		vi.advanceTimersByTime(30_000);
		await settle();

		const sent = { ada: 0, grace: 0 };
		ada.awareness.on('update', (_c: unknown, origin: unknown) => {
			if (origin === 'local') sent.ada += 1;
		});
		grace.awareness.on('update', (_c: unknown, origin: unknown) => {
			if (origin === 'local') sent.grace += 1;
		});
		reopenAda(ada);
		await settle();
		vi.advanceTimersByTime(4_000);
		await settle();

		// Ada's resend and her reply to Grace's answer; Grace's one answer. Then quiet until
		// the ordinary ten-second beat.
		expect(sent.ada).toBeLessThanOrEqual(2);
		expect(sent.grace).toBe(1);
	});

	it('does not put a tab back on the relay as the page unloads', async () => {
		const ada = makeNode('Ada Lovelace');
		const grace = makeNode('Grace Hopper');
		connect();
		await settle();
		// What the provider does on unload: remove this tab's own state.
		removeAwarenessStates(ada.awareness, [ada.awareness.clientID], 'window unload');
		await settle();
		expect(ada.awareness.getLocalState()).toBeNull();
		expect(grace.presence.others).toHaveLength(0);
	});

	it("does not count this browser's other tab as company when saying it is alone", async () => {
		const ada = makeNode('Ada Lovelace');
		const adaTab = makeNode('Ada Lovelace', ada.identity);
		const grace = makeNode('Grace Hopper');
		connect();
		await settle();

		// Ada's socket drops: Grace is gone from her map, her other tab comes back over
		// BroadcastChannel, and she beats meanwhile.
		linked = false;
		removeAwarenessStates(ada.awareness, [grace.awareness.clientID], 'connection');
		deliver(adaTab.awareness, ada.awareness);
		await settle();
		vi.advanceTimersByTime(11_000);
		await settle();
		expect((ada.awareness.getLocalState() as { alone?: boolean }).alone).toBe(true);
	});
});
