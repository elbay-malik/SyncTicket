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
// not anything this module did. `nudge()` below never touches `disconnect`: it abandons the
// live socket (running the library's own close handler at once, so its cleanup is the
// ordinary one, BroadcastChannel included) and then calls `connect()` — safe precisely
// because nothing unsafe came before it.
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
import { isAbandonable } from './abandonable-socket.js';

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
 * A socket that is there is abandoned (`abandonable-socket.ts`): its `close` listeners run
 * now, so the provider does its own cleanup at once (BroadcastChannel stays subscribed), and
 * whatever the dead socket does later is ignored. Plain `close()` would leave the provider
 * waiting for the browser to finish a closing handshake that cannot finish without a network,
 * about ten seconds in Chromium, and nothing reconnects until it does.
 *
 * Then, if the provider is idle (`ws === null && !wsconnected`, exactly `connect()`'s own
 * guard), it connects at once rather than waiting out the backoff.
 */
export function nudge(provider: YProvider): void {
	const socket = provider.ws;
	if (socket) {
		if (isAbandonable(socket)) socket.abandon();
		else socket.close();
	}
	if (provider.ws === null && !provider.wsconnected) void provider.connect();
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
	onCertainOffline: () => void,
	onNetworkBack: () => void = () => {}
): () => void {
	// Nudges wait a small random delay, so tabs that all hear the same event don't all
	// reconnect at once. Tracked so teardown can cancel them: a nudge on a destroyed provider
	// abandons its closing socket and then connects it again for good.
	let stopped = false;
	// A plain bookkeeping set that nothing renders.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const pending = new Set<ReturnType<typeof setTimeout>>();
	const nudgeSoon = () => {
		const timer = setTimeout(() => {
			pending.delete(timer);
			if (!stopped) nudge(provider);
		}, jitterMs());
		pending.add(timer);
	};

	const onOffline = () => {
		// The browser itself reporting no network is a fact the UI already agrees with —
		// this is the one signal in this module certain enough to skip the dwell.
		onCertainOffline();
		nudge(provider);
	};
	const onOnline = () => {
		// Back to "trying" rather than leaving the certain offline in place: otherwise the
		// network returning reads as a relay that can't be reached until the socket opens.
		onNetworkBack();
		nudgeSoon();
	};
	const onVisible = () => {
		const stale = shouldSuspectStale(
			document.visibilityState,
			awareness.getStates().size,
			Date.now() - provider.wsLastMessageReceived
		);
		if (stale) nudgeSoon();
	};

	window.addEventListener('offline', onOffline);
	window.addEventListener('online', onOnline);
	document.addEventListener('visibilitychange', onVisible);

	return () => {
		stopped = true;
		for (const timer of pending) clearTimeout(timer);
		pending.clear();
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
			if (this.#dwellTimer !== null || this.#displayed === 'offline') return;
			this.#dwellTimer = setTimeout(() => {
				this.#dwellTimer = null;
				// The provider may have recovered while this was pending; only commit if
				// 'offline' is still the latest word.
				if (this.raw === 'offline') this.#displayed = 'offline';
			}, OFFLINE_DWELL_MS);
			return;
		}
		if (state === 'connecting') {
			// 'connecting' is not good news — it only means another attempt is in flight, and
			// a relay that is genuinely down emits one before every single retry. Letting it
			// cancel a pending dwell, or pull the display back out of 'offline', is what made
			// a real outage flap connecting↔offline roughly once a second for as long as it
			// lasted — and the status live region announced "You're offline" / "Back online"
			// on every one of those flips. Only a state we are actually sure of gets to
			// change what the user sees.
			if (this.#dwellTimer !== null || this.#displayed === 'offline') return;
			this.#displayed = 'connecting';
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

	/**
	 * The browser reports its network back. Shown as connecting, not left at offline: the
	 * offline was certain, but it is no longer true, and the relay hasn't answered yet either
	 * way. If it can't be reached, the next 'offline' goes through the ordinary dwell.
	 */
	reportNetworkBack(): void {
		if (this.#displayed !== 'offline') return;
		this.#cancelDwell();
		this.raw = 'connecting';
		this.#displayed = 'connecting';
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
