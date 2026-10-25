// The time-bounded record of what peers just changed: issue id -> the latest remote change
// to it, for `TRACE_MS`, then gone. Rows and board cards read it to draw the trace; the
// announcer and the list's off-screen notice subscribe to it for the change stream.
//
// The store fills it and owns the decision about what counts (see `isLiveRemote`); this is
// only the bookkeeping, kept apart so its expiry can be tested without a Y.Doc.

import { SvelteMap } from 'svelte/reactivity';
import { TRACE_MS, type RemoteChange } from './remote-change.js';

export class RemoteActivity {
	#byIssue = new SvelteMap<string, RemoteChange>();
	// Timer bookkeeping that nothing renders; a SvelteMap would add tracking for no reader.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#timers = new Map<string, ReturnType<typeof setTimeout>>();
	// A plain array for the same reason the store's own listener list is one.
	#listeners: Array<(change: RemoteChange) => void> = [];

	/** The remote change still being traced on `issueId`, if any. Reactive. */
	get(issueId: string): RemoteChange | undefined {
		return this.#byIssue.get(issueId);
	}

	/**
	 * Records a change and tells every subscriber about it.
	 *
	 * A second change to the same issue replaces the first and restarts the clock, so a peer
	 * who keeps editing keeps the row marked rather than having it flicker off in between.
	 * Expiry is a timer rather than an `animationend`: under reduced motion the trace does
	 * not animate at all, and an event that never fires would pin it forever.
	 */
	record(change: RemoteChange): void {
		for (const listener of this.#listeners) listener(change);
		if (change.kind === 'deleted') {
			// Nothing left to draw on; whatever was being traced went with the row.
			this.#forget(change.issueId);
			return;
		}
		const previous = this.#timers.get(change.issueId);
		if (previous !== undefined) clearTimeout(previous);
		// A change that lands while the issue is still traced continues that run.
		const since = this.#byIssue.get(change.issueId)?.since ?? change.at;
		this.#byIssue.set(change.issueId, { ...change, since });
		this.#timers.set(
			change.issueId,
			setTimeout(() => this.#forget(change.issueId), TRACE_MS)
		);
	}

	/** Subscribes to every recorded change, returning the unsubscribe function. */
	subscribe(listener: (change: RemoteChange) => void): () => void {
		this.#listeners.push(listener);
		return () => {
			const index = this.#listeners.indexOf(listener);
			if (index !== -1) this.#listeners.splice(index, 1);
		};
	}

	destroy(): void {
		for (const timer of this.#timers.values()) clearTimeout(timer);
		this.#timers.clear();
		this.#byIssue.clear();
		this.#listeners.length = 0;
	}

	#forget(issueId: string): void {
		const timer = this.#timers.get(issueId);
		if (timer !== undefined) clearTimeout(timer);
		this.#timers.delete(issueId);
		this.#byIssue.delete(issueId);
	}
}
