// Why the relay alone cannot keep presence honest.
//
// The relay does clear a peer's awareness state when its socket closes: y-partyserver's
// `onClose` calls `removeAwarenessStates`, and `YDocRoom.onError` now routes an abruptly
// dead socket through the same path (partyserver sends those to `onError`, whose base
// implementation only logs, so without the override they were never cleaned up at all).
//
// That is necessary and not sufficient, and this file pins down the gap. `removeAwarenessStates`
// only notifies about clients it actually finds in memory, and a hibernating Durable Object
// wakes up with an empty awareness map while its WebSockets survive (ADR 0002). So the
// disconnect that arrives after a hibernation cycle removes nothing and tells nobody. These
// tests exist so that the day someone deletes the client-side heartbeat in
// `src/lib/state/presence.svelte.ts`, this explains what they have broken.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Awareness, removeAwarenessStates } from 'y-protocols/awareness';

/** Stands in for the server's awareness map, which is per-instance and never persisted. */
function serverAwareness(): Awareness {
	const awareness = new Awareness(new Y.Doc());
	// y-partyserver clears this on both ends, so the protocol's own 30 s sweep never runs.
	clearInterval(awareness._checkInterval);
	// The server's map holds only remote clients; it has no state of its own.
	awareness.setLocalState(null);
	return awareness;
}

describe('awareness cleanup on the relay', () => {
	it('tells everyone when a peer it still remembers disconnects', () => {
		const server = serverAwareness();
		const peer = 42;
		server.states.set(peer, { name: 'Ada' });
		server.meta.set(peer, { clock: 1, lastUpdated: 0 });

		const broadcasts: number[][] = [];
		server.on('update', ({ removed }: { removed: number[] }) => {
			if (removed.length > 0) broadcasts.push(removed);
		});

		removeAwarenessStates(server, [peer], null);

		expect(broadcasts).toEqual([[peer]]);
		expect(server.states.has(peer)).toBe(false);
	});

	it('tells nobody when the instance woke from hibernation and never knew the peer', () => {
		// The same disconnect, on an instance whose memory was evicted while the socket stayed
		// open. The connection still carries the peer's controlled ids, so `onClose` runs and
		// asks for exactly the same removal — but there is nothing to remove.
		const woken = serverAwareness();
		const broadcasts: number[][] = [];
		woken.on('update', ({ removed }: { removed: number[] }) => {
			if (removed.length > 0) broadcasts.push(removed);
		});

		removeAwarenessStates(woken, [42], null);

		// Silence. Every other client goes on showing a peer who has left, which is why the
		// clients time each other out instead of trusting this message to arrive.
		expect(broadcasts).toEqual([]);
	});

	it('sends a new joiner an empty room after a wake, until someone beats', () => {
		// y-partyserver only pushes awareness to a new connection `if (size > 0)`, and nothing
		// makes the existing peers re-announce: the provider re-announces on socket open, and
		// their sockets never reopened.
		const woken = serverAwareness();
		expect(woken.getStates().size).toBe(0);

		// One heartbeat from a live peer is all it takes to repopulate the map, which is the
		// job the client-side beat is doing.
		woken.states.set(7, { name: 'Grace' });
		expect(woken.getStates().size).toBe(1);
	});
});
