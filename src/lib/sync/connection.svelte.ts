// Smooths the relay's raw connection events into something honest to look at, and holds
// the one client-side liveness trick this stack needs: a nudge, not a reconnect.
//
// Two things this module refuses to do, both load-bearing:
//
// It refuses to call `provider.disconnect()` as part of recovering a suspect socket.
// `disconnect()` unsubscribes BroadcastChannel (`disconnectBc()`), and nothing on the
// organic close → backoff → reconnect path resubscribes it — so a "force a reconnect" built
// on disconnect()+connect() silently and permanently kills multi-tab sync the first time it
// fires. Worse, it doesn't even reconnect anything: `wsconnected`/`ws` are only cleared
// inside the WebSocket's own asynchronous `close` handler, so a `connect()` called right
// after `disconnect()` finds its guard (`!wsconnected && ws === null`) still failing and is
// a no-op — the eventual reconnect that happens anyway is the pre-existing backoff timer,
// not anything this module did. `nudge()` below never touches `disconnect`: it either closes
// the live socket (routing through the library's own correct cleanup and its own
// already-working reconnect, BroadcastChannel included) or, if there is truly nothing to
// close, calls `connect()` alone — safe precisely because nothing unsafe came before it.
//
// It refuses to invent traffic to verify a solo tab's connection. There is no per-update
// delivery acknowledgement anywhere in this protocol, so "confirm my last edit reached the
// relay" has no honest mechanism short of manufacturing round-trip messages — which is
// exactly the steady-state cost ADR 0002 and ADR 0007 exist to avoid paying on an idle room.
// A solo tab's socket only gets checked when the browser hands us a certain signal
// (online/offline) or a reason to suspect staleness (the tab becoming visible again); it is
// never polled on a timer of this module's own making.

import type YProvider from 'y-partyserver/provider';
import type { Awareness } from 'y-protocols/awareness';

export type ConnectionState = 'local' | 'offline' | 'connecting' | 'connected';

/**
 * How long a transition INTO 'offline' waits before it is actually shown.
 *
 * A relay that is simply unreachable retries on a capped exponential backoff — 100ms, 200,
 * 400, 800, 1600, then every 2.5s thereafter (y-partyserver's own numbers, unconfigured) —
 * and every attempt emits `connecting` then `offline` in turn. Driving an icon straight off
 * that stream would strobe it several times a second during an outage. Every other
 * transition (offline → connecting/connected, or a certain signal) applies at once: only
 * uncertain bad news is worth waiting out.
 */
const OFFLINE_DWELL_MS = 1200;

/**
 * How stale `wsLastMessageReceived` has to be, while other peers are known, before a
 * visibility restore treats the socket as suspect.
 *
 * Tighter than Presence's own 25s peer-staleness bound (`state/presence.svelte.ts`), so a
 * nudge fixes the connection before Presence would otherwise have to hide a peer who is
 * actually still there.
 */
const STALE_TRAFFIC_MS = 20_000;

/** A little randomisation before any nudge that more than one tab could trigger at once. */
function jitterMs(): number {
	return Math.random() * 250;
}

/**
 * Prods a socket that might be dead, without ever calling `disconnect()`.
 *
 * If a (possibly half-open) socket is open, closing it routes through the provider's own
 * `close` handler — the same cleanup and the same backoff-driven reconnect an ordinary drop
 * already goes through, BroadcastChannel resubscription included. If there is genuinely
 * nothing to close, the provider is sitting in the gap between backoff attempts
 * (`ws === null && !wsconnected`), which is exactly `connect()`'s own guard — calling it
 * here, with nothing unsafe preceding it, jumps the remaining wait rather than idling it out.
 */
export function nudge(provider: YProvider): void {
	if (provider.ws) {
		provider.ws.close();
	} else if (!provider.wsconnected) {
		void provider.connect();
	}
}

/** Same as `nudge`, after a small random delay so simultaneous tabs don't all fire at once. */
function nudgeSoon(provider: YProvider): void {
	setTimeout(() => nudge(provider), jitterMs());
}

/**
 * Pure decision behind the visibility check, separated from `document`/`Date.now()` so it
 * can be driven with a synthetic sequence in a test rather than the real Page Visibility API.
 */
export function shouldSuspectStale(
	visibilityState: DocumentVisibilityState,
	peerStatesKnown: number,
	msSinceLastMessage: number
): boolean {
	if (visibilityState !== 'visible') return false;
	// The same gate ADR 0007 uses for the presence heartbeat: while other peers are known,
	// their own heartbeats keep `wsLastMessageReceived` advancing every ~10s for free, so
	// staleness beyond that is a real signal rather than an idle solo tab's ordinary silence.
	if (peerStatesKnown <= 1) return false;
	return msSinceLastMessage >= STALE_TRAFFIC_MS;
}

/**
 * Wires the two certain-or-cheap liveness signals this stack has, onto `provider`.
 *
 * Deliberately not a periodic watchdog: a network-path failure that neither flips
 * `navigator.onLine` nor happens to coincide with the tab regaining visibility corrects
 * itself only once the browser's own TCP timeout elapses. That is a real gap — the
 * connection badge and, eventually, Presence's peer list can lag reality for longer than
 * either of the two signals below would allow — but it costs a stale badge, never data: the
 * document is local-first regardless of what the badge says. Closing it would mean either
 * polling on a timer (the steady-state cost this module exists to avoid) or manufacturing
 * traffic to verify a solo tab, which has no honest mechanism (see the module comment).
 *
 * Returns a teardown function. Registers nothing when `!browser`, via the caller's own guard
 * in `attachRelay` — this function is never called there unless a provider was constructed.
 */
export function watchConnection(
	provider: YProvider,
	awareness: Awareness,
	onCertainOffline: () => void
): () => void {
	const onOffline = () => {
		// The browser itself reporting no network is a fact the UI already agrees with —
		// this is the one signal in this module certain enough to skip the dwell.
		onCertainOffline();
		nudge(provider);
	};
	const onOnline = () => nudgeSoon(provider);
	const onVisible = () => {
		const stale = shouldSuspectStale(
			document.visibilityState,
			awareness.getStates().size,
			Date.now() - provider.wsLastMessageReceived
		);
		if (stale) nudgeSoon(provider);
	};

	window.addEventListener('offline', onOffline);
	window.addEventListener('online', onOnline);
	document.addEventListener('visibilitychange', onVisible);

	return () => {
		window.removeEventListener('offline', onOffline);
		window.removeEventListener('online', onOnline);
		document.removeEventListener('visibilitychange', onVisible);
	};
}

/**
 * Debounces a raw connection-state stream into one fit for a human, with no transport of
 * its own — driven by whatever calls `report`/`reportCertain`, so a test can feed it a
 * synthetic sequence without a socket, the same way `Presence` is tested against bare
 * `Awareness` instances rather than a real relay.
 */
export class ConnectionStatus {
	#dwellTimer: ReturnType<typeof setTimeout> | null = null;

	/** The latest state as the provider actually reported it, undebounced. */
	raw = $state<ConnectionState>('local');
	#displayed = $state<ConnectionState>('local');

	/** What the UI should show. */
	get displayed(): ConnectionState {
		return this.#displayed;
	}

	/** An ordinary event from the provider — a transition into 'offline' is debounced. */
	report(state: ConnectionState): void {
		this.raw = state;
		if (state === 'offline') {
			if (this.#dwellTimer !== null) return;
			this.#dwellTimer = setTimeout(() => {
				this.#dwellTimer = null;
				// The provider may have recovered while this was pending; only commit if
				// 'offline' is still the latest word.
				if (this.raw === 'offline') this.#displayed = 'offline';
			}, OFFLINE_DWELL_MS);
			return;
		}
		this.#cancelDwell();
		this.#displayed = state;
	}

	/**
	 * A signal this module is certain about — the browser itself reports no network — skips
	 * the dwell. Delaying a fact the user already knows (their wifi icon says the same thing)
	 * serves nobody, unlike an ordinary retry blip.
	 */
	reportCertainOffline(): void {
		this.#cancelDwell();
		this.raw = 'offline';
		this.#displayed = 'offline';
	}

	destroy(): void {
		this.#cancelDwell();
	}

	#cancelDwell(): void {
		if (this.#dwellTimer === null) return;
		clearTimeout(this.#dwellTimer);
		this.#dwellTimer = null;
	}
}
