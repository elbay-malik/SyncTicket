// A WebSocket the app can give up on at once, instead of waiting for the browser to agree it
// has closed.
//
// `close()` on a socket whose network has gone only starts the closing handshake. The socket
// sits in CLOSING until the browser gives up on the handshake, about ten seconds in Chromium,
// and only then fires `close`. y-partyserver reconnects from that `close` handler and nowhere
// else, and `connect()` refuses to run while `provider.ws` is still set, so for those ten
// seconds nothing can reconnect: a two-second blip in the network took ten seconds to recover
// from, however soon the network came back.
//
// The provider's handlers are written against `provider`, not the socket they were attached
// to, so a socket's late `close` also clears whatever socket replaced it. That is why giving up
// on a socket has to happen here, where its events can be silenced, rather than by clearing
// `provider.ws` from outside.

/** What {@link abandonable} adds to a WebSocket class. */
export interface Abandonable {
	/**
	 * Closes the socket and runs its `close` listeners now, then ignores anything the socket
	 * does afterwards: a late `close`, a message, an error. Safe to call more than once.
	 */
	abandon(): void;
}

type Listener = EventListenerOrEventListenerObject;

/** Wraps a WebSocket class (the browser's, or a test's) so its sockets can be abandoned. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeScript's mixin rule
export function abandonable<T extends new (...args: any[]) => WebSocket>(Base: T) {
	return class AbandonableSocket extends Base implements Abandonable {
		#abandoned = false;
		/** True only while `abandon()` delivers its own `close`, the one event let through. */
		#delivering = false;
		#wrapped = new WeakMap<Listener, EventListener>();

		override addEventListener(
			type: string,
			listener: Listener | null,
			options?: boolean | AddEventListenerOptions
		): void {
			if (!listener) return;
			let wrapped = this.#wrapped.get(listener);
			if (!wrapped) {
				wrapped = (event: Event) => {
					if (this.#abandoned && !this.#delivering) return;
					if (typeof listener === 'function') listener.call(this, event);
					else listener.handleEvent(event);
				};
				this.#wrapped.set(listener, wrapped);
			}
			super.addEventListener(type, wrapped, options);
		}

		override removeEventListener(
			type: string,
			listener: Listener | null,
			options?: boolean | EventListenerOptions
		): void {
			if (!listener) return;
			super.removeEventListener(type, this.#wrapped.get(listener) ?? listener, options);
		}

		abandon(): void {
			if (this.#abandoned) return;
			this.#abandoned = true;
			// Still sent, so a relay that can hear us drops the connection now rather than when
			// its own timeout notices.
			try {
				this.close();
			} catch {
				// Nothing to do: the socket is being left behind either way.
			}
			this.#delivering = true;
			try {
				this.dispatchEvent(new CloseEvent('close', { code: 4000, reason: 'abandoned' }));
			} finally {
				this.#delivering = false;
			}
		}
	};
}

export function isAbandonable(socket: unknown): socket is Abandonable {
	return (
		typeof socket === 'object' &&
		socket !== null &&
		typeof (socket as Partial<Abandonable>).abandon === 'function'
	);
}
