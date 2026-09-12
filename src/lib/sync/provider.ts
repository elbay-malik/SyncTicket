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

/**
 * The party name the relay is reachable at.
 *
 * partyserver derives the URL namespace by kebab-casing the Durable Object *binding* name,
 * so this string and `durable_objects.bindings[0].name` in workers/relay/wrangler.jsonc are
 * the same fact written twice. The provider's own default is `main`, which the relay
 * rejects with a 400.
 */
export const RELAY_PARTY = 'y-doc-room';

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
		return { provider: null, awareness, destroy: () => awareness.destroy() };
	}

	const provider = new YProvider(host, workspaceId, doc, { party: RELAY_PARTY, awareness });

	handlers.onConnection('connecting');
	provider.on('status', (event: StatusEvent) => {
		handlers.onConnection(event.status === 'disconnected' ? 'offline' : event.status);
	});
	// `status` alone can never report a relay that was never reachable: it only emits
	// `disconnected` for a socket that had previously opened, so an unreachable relay would
	// sit on 'connecting' forever.
	provider.on('connection-close', () => handlers.onConnection('offline'));
	provider.on('connection-error', () => handlers.onConnection('offline'));
	provider.on('synced', (synced: boolean) => handlers.onSynced(synced));

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
