// The reconnect breaker, against the real y-partyserver provider and a fake WebSocket.
//
// Two failure modes have to be told apart. A relay that accepts the socket and then closes it
// would be retried every 100ms forever, so the breaker stops it. A relay that is simply down
// fails every attempt without opening, and the library already backs that off; the breaker used
// to count those failures too, trip after about 13 seconds of outage, and never reconnect.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';
import {
	BREAKER_COOLDOWN_MS,
	BREAKER_MAX_COOLDOWN_MS,
	CLOSE_BURST_LIMIT,
	guardReconnects
} from './provider.js';

type Behaviour = 'refuse' | 'accept-then-close' | 'accept';

/** A WebSocket whose fate is decided by `relay.behaviour` when it is dialled. */
class FakeSocket extends EventTarget {
	static relay: { behaviour: Behaviour; dialled: number } = { behaviour: 'refuse', dialled: 0 };
	binaryType = 'arraybuffer';
	readyState = 0;
	constructor(readonly url: string) {
		super();
		FakeSocket.relay.dialled += 1;
		const behaviour = FakeSocket.relay.behaviour;
		setTimeout(() => {
			if (behaviour === 'refuse') {
				this.dispatchEvent(new Event('error'));
				this.close();
				return;
			}
			this.readyState = 1;
			this.dispatchEvent(new Event('open'));
			if (behaviour === 'accept-then-close') this.close();
		}, 0);
	}
	send() {}
	close() {
		if (this.readyState === 3) return;
		this.readyState = 3;
		this.dispatchEvent(new CloseEvent('close', { code: 1006 }));
	}
}

const cleanups: Array<() => void> = [];

beforeEach(() => {
	vi.useFakeTimers();
	FakeSocket.relay = { behaviour: 'refuse', dialled: 0 };
});

afterEach(() => {
	while (cleanups.length) cleanups.pop()?.();
	vi.useRealTimers();
});

function connect(behaviour: Behaviour) {
	FakeSocket.relay.behaviour = behaviour;
	const doc = new Y.Doc();
	const provider = new YProvider('relay.example:1999', 'room', doc, {
		party: 'y-doc-room',
		maxBackoffTime: 30_000,
		WebSocketPolyfill: FakeSocket as unknown as typeof WebSocket
	});
	const release = guardReconnects(provider);
	cleanups.push(() => {
		release();
		provider.destroy();
		doc.destroy();
	});
	return provider;
}

describe('guardReconnects', () => {
	it('keeps retrying through a long outage, and reconnects when the relay is back', async () => {
		// Established first, so the outage starts the way it does for an open tab.
		const provider = connect('accept');
		await vi.advanceTimersByTimeAsync(10);
		expect(provider.wsconnected).toBe(true);

		FakeSocket.relay.behaviour = 'refuse';
		provider.ws?.close();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(provider.shouldConnect).toBe(true);
		const failures = FakeSocket.relay.dialled;
		expect(failures).toBeGreaterThan(CLOSE_BURST_LIMIT);

		FakeSocket.relay.behaviour = 'accept';
		await vi.advanceTimersByTimeAsync(30_000);
		expect(provider.wsconnected).toBe(true);
	});

	it('stops a relay that accepts and then closes from being retried flat out', async () => {
		const provider = connect('accept-then-close');
		await vi.advanceTimersByTimeAsync(5_000);

		expect(provider.shouldConnect).toBe(false);
		// Without the breaker this is a dial every 100ms: about 50 in 5 seconds.
		expect(FakeSocket.relay.dialled).toBe(CLOSE_BURST_LIMIT);
	});

	it('tries again after the cooldown, and comes back once the relay is fixed', async () => {
		const provider = connect('accept-then-close');
		await vi.advanceTimersByTimeAsync(5_000);
		expect(provider.shouldConnect).toBe(false);

		FakeSocket.relay.behaviour = 'accept';
		await vi.advanceTimersByTimeAsync(BREAKER_COOLDOWN_MS);
		expect(provider.wsconnected).toBe(true);
		expect(provider.shouldConnect).toBe(true);
	});

	it('waits twice as long each time it trips, up to the maximum', async () => {
		connect('accept-then-close');
		const dialsPerTrip = CLOSE_BURST_LIMIT;
		const trips = (dials: number) => Math.floor(dials / dialsPerTrip);

		// Trip 1 at once; trip 2 after 30s; trip 3 after 60s more; trip 4 after 120s more.
		await vi.advanceTimersByTimeAsync(5_000);
		expect(trips(FakeSocket.relay.dialled)).toBe(1);
		await vi.advanceTimersByTimeAsync(BREAKER_COOLDOWN_MS);
		expect(trips(FakeSocket.relay.dialled)).toBe(2);
		await vi.advanceTimersByTimeAsync(BREAKER_COOLDOWN_MS * 2 - 5_000);
		expect(trips(FakeSocket.relay.dialled)).toBe(2);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(trips(FakeSocket.relay.dialled)).toBe(3);

		// A day against a relay that never gets fixed stays far inside the request budget.
		FakeSocket.relay.dialled = 0;
		await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
		const perDay = FakeSocket.relay.dialled;
		expect(perDay).toBeLessThanOrEqual(
			((24 * 60 * 60_000) / BREAKER_MAX_COOLDOWN_MS + 1) * dialsPerTrip
		);
	});

	it('stops retrying once torn down', async () => {
		const provider = connect('accept-then-close');
		await vi.advanceTimersByTimeAsync(5_000);
		cleanups.pop()?.();
		const dialled = FakeSocket.relay.dialled;

		await vi.advanceTimersByTimeAsync(BREAKER_COOLDOWN_MS * 2);
		expect(FakeSocket.relay.dialled).toBe(dialled);
		expect(provider.shouldConnect).toBe(false);
	});
});
