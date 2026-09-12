// Phase 11 acceptance: the relay's connecting/offline flap gets smoothed into something a
// human can look at, without ever going through the broken disconnect()+connect() recipe.
//
// `ConnectionStatus` and `shouldSuspectStale` are both transport-free by design, the same
// reason `Presence` is tested against a bare `Awareness` rather than a real relay: driving
// this through an actual `YProvider` would need a live or synthetically routed socket, which
// browser-mode unit tests in this repo don't otherwise use.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionStatus, nudge, shouldSuspectStale } from './connection.svelte.js';

describe('ConnectionStatus', () => {
	const statuses: ConnectionStatus[] = [];
	function make(): ConnectionStatus {
		const status = new ConnectionStatus();
		statuses.push(status);
		return status;
	}

	afterEach(() => {
		while (statuses.length) statuses.pop()?.destroy();
		vi.useRealTimers();
	});

	it('applies good news immediately: local, connecting and connected all show at once', () => {
		const status = make();
		status.report('local');
		expect(status.displayed).toBe('local');
		status.report('connecting');
		expect(status.displayed).toBe('connecting');
		status.report('connected');
		expect(status.displayed).toBe('connected');
	});

	it('holds off showing offline, in case the very next retry succeeds', () => {
		vi.useFakeTimers();
		const status = make();
		status.report('connected');
		status.report('offline');
		// Still showing the old state a moment later — this is the flap a real outage
		// produces every ~100ms to 2.5s, and none of it should reach the icon.
		vi.advanceTimersByTime(500);
		expect(status.displayed).toBe('connected');
		vi.advanceTimersByTime(1000);
		expect(status.displayed).toBe('offline');
	});

	it('cancels the pending offline verdict the moment good news arrives', () => {
		vi.useFakeTimers();
		const status = make();
		status.report('connected');
		status.report('offline');
		vi.advanceTimersByTime(800);
		status.report('connecting'); // the very next retry, still within the dwell window
		vi.advanceTimersByTime(1000);
		// Never flips to 'offline': the retry succeeded before the dwell timer fired.
		expect(status.displayed).toBe('connecting');
	});

	it('does not restart the dwell on a repeated offline report', () => {
		vi.useFakeTimers();
		const status = make();
		status.report('connected');
		status.report('offline');
		vi.advanceTimersByTime(900);
		status.report('offline'); // the next failed retry in the same outage
		vi.advanceTimersByTime(400);
		// 1300ms since the first report, past the 1200ms dwell — a naive restart-on-every-
		// report implementation would still be waiting at this point.
		expect(status.displayed).toBe('offline');
	});

	it('skips the dwell entirely for a certain signal', () => {
		vi.useFakeTimers();
		const status = make();
		status.report('connected');
		status.reportCertainOffline();
		expect(status.displayed).toBe('offline');
	});

	it('a certain offline cancels a dwell that was already pending', () => {
		vi.useFakeTimers();
		const status = make();
		status.report('connected');
		status.report('offline');
		vi.advanceTimersByTime(100);
		status.reportCertainOffline();
		expect(status.displayed).toBe('offline');
		// The stale pending timer must not later clobber a subsequent recovery.
		status.report('connecting');
		vi.advanceTimersByTime(2000);
		expect(status.displayed).toBe('connecting');
	});

	it('destroy() clears a pending dwell so it cannot fire after teardown', () => {
		vi.useFakeTimers();
		const status = new ConnectionStatus();
		status.report('connected');
		status.report('offline');
		status.destroy();
		// Nothing left to advance into a crash or a write to a torn-down component's state;
		// this only proves the timer is gone, since there is nothing observable to assert
		// beyond "advancing time doesn't throw."
		expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
	});

	it('exposes the undebounced signal as `raw`, for anything that wants the truth', () => {
		vi.useFakeTimers();
		const status = make();
		status.report('offline');
		expect(status.raw).toBe('offline');
		expect(status.displayed).toBe('local'); // still dwelling
	});
});

describe('shouldSuspectStale', () => {
	it('never suspects a hidden or prerendering tab', () => {
		expect(shouldSuspectStale('hidden', 5, 999_999)).toBe(false);
	});

	it('never suspects a solo tab, no matter how stale — there is no traffic to expect', () => {
		expect(shouldSuspectStale('visible', 1, 999_999)).toBe(false);
		expect(shouldSuspectStale('visible', 0, 999_999)).toBe(false);
	});

	it('does not suspect a tab that heard from a peer recently', () => {
		expect(shouldSuspectStale('visible', 2, 5_000)).toBe(false);
	});

	it('suspects a visible tab with known peers and stale traffic', () => {
		expect(shouldSuspectStale('visible', 2, 20_000)).toBe(true);
	});
});

describe('nudge', () => {
	interface FakeSocket {
		close: ReturnType<typeof vi.fn>;
	}
	function fakeProvider(overrides: { ws?: FakeSocket | null; wsconnected?: boolean }) {
		return {
			ws: overrides.ws ?? null,
			wsconnected: overrides.wsconnected ?? false,
			connect: vi.fn()
		};
	}

	it('closes a live socket rather than calling disconnect() or connect()', () => {
		const socket: FakeSocket = { close: vi.fn() };
		const provider = fakeProvider({ ws: socket, wsconnected: true });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- duck-typed YProvider
		nudge(provider as any);
		expect(socket.close).toHaveBeenCalledTimes(1);
		expect(provider.connect).not.toHaveBeenCalled();
	});

	it('calls connect() only when genuinely idle between backoff attempts', () => {
		const provider = fakeProvider({ ws: null, wsconnected: false });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- duck-typed YProvider
		nudge(provider as any);
		expect(provider.connect).toHaveBeenCalledTimes(1);
	});

	it('does nothing when the provider is already connecting — the exact case connect() itself guards against', () => {
		// ws === null but wsconnected === true never happens in the real library, but this
		// mirrors connect()'s own guard (`!wsconnected && ws === null`) exactly, so nudge()
		// can never make a call the library's own safety check would have refused.
		const provider = fakeProvider({ ws: null, wsconnected: true });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- duck-typed YProvider
		nudge(provider as any);
		expect(provider.connect).not.toHaveBeenCalled();
	});
});
