// Giving up on a socket whose network has gone, against the real y-partyserver provider.
//
// The socket below behaves the way Chromium's does once the network has gone: `close()` only
// starts the closing handshake, and `close` fires when the browser gives up on it, about ten
// seconds later. Until then the provider has `ws` set and `connect()` does nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';
import { abandonable } from './abandonable-socket.js';
import { nudge } from './connection.svelte.js';

const HANDSHAKE_GIVE_UP_MS = 10_000;

class StallingSocket extends EventTarget {
	static opened: StallingSocket[] = [];
	readonly CONNECTING = 0;
	readonly OPEN = 1;
	readonly CLOSING = 2;
	readonly CLOSED = 3;
	binaryType = 'arraybuffer';
	readyState = 0;
	sent = 0;
	constructor(readonly url: string) {
		super();
		StallingSocket.opened.push(this);
		setTimeout(() => {
			if (this.readyState !== 0) return;
			this.readyState = 1;
			this.dispatchEvent(new Event('open'));
		}, 0);
	}
	send() {
		this.sent += 1;
	}
	close() {
		if (this.readyState >= 2) return;
		this.readyState = 2;
		setTimeout(() => {
			this.readyState = 3;
			this.dispatchEvent(new CloseEvent('close', { code: 1006 }));
		}, HANDSHAKE_GIVE_UP_MS);
	}
	/** A message arriving on a socket the app has already given up on. */
	receive() {
		this.dispatchEvent(new MessageEvent('message', { data: new Uint8Array([0, 0, 0]).buffer }));
	}
}

const cleanups: Array<() => void> = [];

beforeEach(() => {
	vi.useFakeTimers();
	StallingSocket.opened = [];
});

afterEach(() => {
	while (cleanups.length) cleanups.pop()?.();
	vi.useRealTimers();
});

function connect(Socket: typeof WebSocket) {
	const doc = new Y.Doc();
	const provider = new YProvider('relay.example:1999', 'room', doc, {
		party: 'y-doc-room',
		maxBackoffTime: 30_000,
		WebSocketPolyfill: Socket
	});
	cleanups.push(() => {
		provider.destroy();
		doc.destroy();
	});
	return provider;
}

describe('nudge with an abandonable socket', () => {
	it('reconnects at once, instead of after the browser gives up on the closing handshake', async () => {
		const provider = connect(abandonable(StallingSocket as unknown as typeof WebSocket));
		await vi.advanceTimersByTimeAsync(10);
		expect(provider.wsconnected).toBe(true);

		nudge(provider);
		await vi.advanceTimersByTimeAsync(10);
		expect(StallingSocket.opened).toHaveLength(2);
		expect(provider.ws).toBe(StallingSocket.opened[1]);
		expect(provider.wsconnected).toBe(true);
	});

	it("ignores the old socket's late close, which would otherwise clear the new one", async () => {
		const provider = connect(abandonable(StallingSocket as unknown as typeof WebSocket));
		await vi.advanceTimersByTimeAsync(10);
		nudge(provider);
		await vi.advanceTimersByTimeAsync(10);
		const fresh = provider.ws;

		const old = StallingSocket.opened[0] as StallingSocket;
		await vi.advanceTimersByTimeAsync(HANDSHAKE_GIVE_UP_MS);
		expect(old.readyState).toBe(3);
		expect(provider.ws).toBe(fresh);
		expect(provider.wsconnected).toBe(true);
		// Nor did that close start yet another socket.
		expect(StallingSocket.opened).toHaveLength(2);

		// And whatever else the old socket says is not taken as the relay talking.
		const before = provider.wsLastMessageReceived;
		await vi.advanceTimersByTimeAsync(2_000);
		old.receive();
		expect(provider.wsLastMessageReceived).toBe(before);
	});

	it('without it, nothing reconnects until the handshake gives up', async () => {
		// The behaviour this fixes, kept as a test so the reason for the wrapper stays visible.
		const provider = connect(StallingSocket as unknown as typeof WebSocket);
		await vi.advanceTimersByTimeAsync(10);
		nudge(provider);
		await vi.advanceTimersByTimeAsync(HANDSHAKE_GIVE_UP_MS - 100);
		expect(StallingSocket.opened).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(500);
		expect(StallingSocket.opened).toHaveLength(2);
	});

	it('nudging twice in a row leaves one live socket', async () => {
		const provider = connect(abandonable(StallingSocket as unknown as typeof WebSocket));
		await vi.advanceTimersByTimeAsync(10);
		nudge(provider);
		nudge(provider);
		await vi.advanceTimersByTimeAsync(HANDSHAKE_GIVE_UP_MS * 2);
		const live = StallingSocket.opened.filter((socket) => socket.readyState === 1);
		expect(live).toHaveLength(1);
		expect(provider.ws).toBe(live[0]);
	});
});
