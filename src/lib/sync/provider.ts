// The websocket connection to the relay.
//
// Optional by design: with no relay host configured the app behaves exactly as it did
// before Phase 9 — local-first, offline, and with no socket at all. That is also what every
// existing test runs against.

import { browser } from '$app/environment';
import YProvider from 'y-partyserver/provider';
import { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { watchConnection, type ConnectionState } from './connection.svelte.js';
import { parsePersistenceNotice, type PersistenceNotice } from './relay-notice.js';

/**
 * The party name the relay is reachable at.
 *
 * partyserver derives the URL namespace by kebab-casing the Durable Object *binding* name,
 * so this string and `durable_objects.bindings[0].name` in workers/relay/wrangler.jsonc are
 * the same fact written twice. The provider's own default is `main`, which the relay
 * rejects with a 400.
 */
export const RELAY_PARTY = 'y-doc-room';

/** How many closes inside {@link CLOSE_BURST_WINDOW_MS} count as a relay that is refusing us. */
const CLOSE_BURST_LIMIT = 8;
const CLOSE_BURST_WINDOW_MS = 20_000;

export type { ConnectionState };

export interface RelayConnection {
	readonly provider: YProvider | null;
	/**
	 * Present whether or not a relay is configured.
	 *
	 * Presence is a local concept first: with no relay the only member is you, and the UI
	 * renders that without branching. It also keeps the bridge testable without a socket.
	 */
	readonly awareness: Awareness;
	destroy(): void;
}

/** lib0's Observable types its listeners as bare `Function`, so the payloads are named here. */
interface StatusEvent {
	status: 'connecting' | 'connected' | 'disconnected';
}

export interface RelayHandlers {
	onConnection(state: ConnectionState): void;
	/**
	 * A signal certain enough to skip whatever debouncing the caller applies to `onConnection`
	 * — today that means the browser itself reporting no network, which the user's own wifi
	 * icon already agrees with, unlike an ordinary retry blip.
	 */
	onOffline(): void;
	/** Fires with true once the relay and this client have exchanged state. */
	onSynced(synced: boolean): void;
	/**
	 * The relay telling us whether it can still store this workspace — independent of
	 * whether the socket is up.
	 *
	 * The two really are separate: a room whose SQLite write hit Cloudflare's 2 MB row cap
	 * keeps relaying every update in memory, so the connection is as healthy as it ever was
	 * while nothing is being persisted. Only the relay knows that, and only because it looks:
	 * y-partyserver's own save path catches the error and logs it.
	 */
	onPersistence(notice: PersistenceNotice): void;
}

/**
 * Connects `doc` to the relay, if one is configured.
 *
 * Attached synchronously by the store for the same reason persistence is: a provider that
 * arrives late misses the updates made in the gap. Teardown order matters in the other
 * direction — see `destroy` below.
 */
export function attachRelay(
	doc: Y.Doc,
	workspaceId: string,
	handlers: RelayHandlers
): RelayConnection {
	// Constructed before the host check so the offline path has one too. Destroying the doc
	// destroys it in turn — Awareness registers a `destroy` handler on the doc it is given —
	// so this adds no teardown obligation beyond what the store already has.
	const awareness = new Awareness(doc);
	// y-partyserver clears this interval on the awareness it is handed, and so does the
	// server, which is why nothing in this stack expires a stale peer on its own. Cleared
	// here as well so the no-relay path behaves identically to the connected one, and
	// liveness has exactly one owner: `state/presence.svelte.ts`.
	clearInterval(awareness._checkInterval);

	// host[:port], no protocol and no path. The provider picks ws:// only for hosts it
	// recognises as local (`localhost:`, `127.0.0.1:`, private ranges), so a bare hostname
	// without a port would be dialled over wss:// and fail in development.
	//
	// Read through `import.meta.env` rather than `$env/dynamic/public`: the dynamic module is
	// a SvelteKit runtime virtual module that does not resolve in the browser-mode unit
	// tests, and this value is a build-time deployment fact anyway.
	const host = import.meta.env.PUBLIC_RELAY_HOST?.trim();
	if (!browser || !host) {
		// Nothing is wrong here — there is simply nothing to connect to. Reported explicitly
		// rather than left as the `#connection` field's default, so 'local' actually reaches
		// the UI instead of being indistinguishable from a relay that failed to connect.
		handlers.onConnection('local');
		// `onPersistence` is deliberately *not* called on this path, unlike the explicit
		// 'local' report just above. Relay persistence state stays at the store's 'ok'
		// default, because there is no relay whose storage could be degraded: the only
		// durability question a local-only session has is IndexedDB, which `persisted`
		// already answers. Reporting 'ok' here would be the same value by a louder route,
		// and reporting anything else would invent a relay that does not exist.
		return { provider: null, awareness, destroy: () => awareness.destroy() };
	}

	// `maxBackoffTime` raises y-partyserver's own 2.5s ceiling. That default means a tab left
	// open against a relay it cannot reach retries ~34,500 times a day, and the Workers free
	// plan's request budget is account-wide — so a handful of forgotten tabs can spend the
	// app worker's quota on failures alone. Thirty seconds is still well inside "recovers
	// while you are looking at it", and the browser's own online/visibilitychange signals
	// (see connection.svelte.ts) bypass the wait entirely when something actually changes.
	const provider = new YProvider(host, workspaceId, doc, {
		party: RELAY_PARTY,
		awareness,
		maxBackoffTime: 30_000
	});

	handlers.onConnection('connecting');
	provider.on('status', (event: StatusEvent) => {
		handlers.onConnection(event.status === 'disconnected' ? 'offline' : event.status);
	});
	// `status` alone can never report a relay that was never reachable: it only emits
	// `disconnected` for a socket that had previously opened, so an unreachable relay would
	// sit on 'connecting' forever.
	//
	// The close handler also trips a breaker. y-partyserver resets its backoff counter on the
	// socket's `open` event rather than on a working session, so a relay that accepts the
	// upgrade and then immediately closes — what partyserver does if `onStart`/`onConnect`
	// throws — never backs off at all: it retries flat out at 100ms, ~864,000 requests a day
	// from a single tab, against an account-wide free-plan budget of 100,000. Stopping after
	// a burst costs nothing, because `nudge()` calls `connect()` (which sets `shouldConnect`
	// back to true) the moment the browser reports a real change — coming back online, or the
	// tab being looked at again.
	const closes: number[] = [];
	provider.on('connection-close', () => {
		handlers.onConnection('offline');
		const now = Date.now();
		closes.push(now);
		while (closes.length > 0 && now - (closes[0] as number) > CLOSE_BURST_WINDOW_MS) {
			closes.shift();
		}
		if (closes.length >= CLOSE_BURST_LIMIT) {
			closes.length = 0;
			provider.shouldConnect = false;
		}
	});
	provider.on('connection-error', () => handlers.onConnection('offline'));
	provider.on('synced', (synced: boolean) => handlers.onSynced(synced));
	// The relay's storage health, pushed as a string frame over y-partyserver's custom
	// message channel.
	//
	// Note what the provider does with a string frame: it emits 'custom-message' and
	// `return`s *before* `wsLastMessageReceived = time.getUnixTime()`
	// (`y-partyserver/dist/provider/index.js` ~101-107 — the assignment is on the line after
	// the `return`, on the binary path only). So these notices are not liveness traffic, and
	// nothing may later be built on this channel that assumes they are: a heartbeat sent
	// here would be invisible to every staleness check in the stack. That is the right way
	// round — ADRs 0007/0008 settled that this stack does not manufacture its own liveness
	// traffic — and it is recorded here so a future heartbeat is not quietly added to a
	// channel that cannot carry one.
	provider.on('custom-message', (raw: string) => {
		const notice = parsePersistenceNotice(raw);
		if (notice) handlers.onPersistence(notice);
		// Anything unrecognised is ignored, on purpose. The frame is whatever the socket
		// handed us, and the channel carries a closed enum rather than display text, so the
		// worst a malformed or hostile frame can do is nothing at all.
	});

	// The two certain-or-cheap signals this stack has for a socket the library itself will
	// not notice is dead — see connection.svelte.ts for why this is not a periodic watchdog
	// and does not call `disconnect()`.
	const unwatch = watchConnection(provider, awareness, handlers.onOffline);

	return {
		provider,
		awareness,
		destroy() {
			unwatch();
			// Before the doc is destroyed, not after: the provider only registers a `doc.update`
			// handler and does not tear itself down on `doc.destroy()`, so a socket left open
			// would apply an inbound sync message to a destroyed document.
			provider.destroy();
		}
	};
}
