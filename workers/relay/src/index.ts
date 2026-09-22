// The Yjs relay: one hibernating Durable Object per workspace.
//
// It is a separate Worker from the app because the stable adapter-cloudflare cannot export
// Durable Object classes, and Wrangler requires a class's migration to live with the worker
// that defines it (ADR 0002). The browser connects here directly over WebSocket, so the app
// worker never proxies sync traffic.

import { routePartykitRequest, type Connection } from 'partyserver';
import type * as Y from 'yjs';
import { YServer } from 'y-partyserver';
import {
	createTableSql,
	decodeSnapshot,
	encodeSnapshot,
	readSnapshotSql,
	writeSnapshotSql
} from './storage.js';
import { isRoutableRoom } from './rooms.js';

export class YDocRoom extends YServer<Env> {
	// Hibernation is what makes an idle room free: the instance is evicted, its memory with
	// it, and only the WebSockets survive. Everything in the document therefore has to be
	// recoverable from storage below.
	static override options = { hibernate: true };

	// The default is a 2 s debounce with a 10 s ceiling, which is a long time to hold the
	// only copy of a change in evictable memory. Shorter costs a few more writes to a
	// database the room already pays for.
	static override callbackOptions = { debounceWait: 300, debounceMaxWait: 2000 };

	override async onLoad(): Promise<Y.Doc | void> {
		this.ctx.storage.sql.exec(createTableSql());
		const row = [...this.ctx.storage.sql.exec(readSnapshotSql())][0];
		return decodeSnapshot(row?.doc);
	}

	override async onSave(): Promise<void> {
		this.ctx.storage.sql.exec(writeSnapshotSql(), encodeSnapshot(this.document));
	}

	/**
	 * Clears presence for a socket that died rather than closed.
	 *
	 * partyserver routes `webSocketError` here, and the base implementation only logs, so
	 * without this the peer's awareness state stays on the server and on every other
	 * client. YServer implements the equivalent cleanup in `onClose`, which the runtime
	 * does not call on this path — so it is called by hand, with the close code for an
	 * abnormal closure, before the socket is dropped.
	 */
	override onError(connection: Connection, error: unknown): void {
		console.error('relay socket error', error);
		this.onClose(connection, 1006, 'socket error', false);
		try {
			connection.close(1011, 'socket error');
		} catch {
			// Already gone; the cleanup above is the part that matters.
		}
	}
}

export default {
	async fetch(request, env) {
		// routePartykitRequest is async: awaiting it is what makes the fallback reachable at
		// all, and without a fallback an unmatched path resolves to null, which workerd
		// rejects outright.
		//
		// The hooks below run *before* the Durable Object stub is fetched (partyserver
		// `dist/index.js:527-538`; `idFromName` on :508 is pure id maths and creates
		// nothing), which is the only place a room can be refused without having already
		// made one.
		const routed = await routePartykitRequest(request, env, {
			onBeforeConnect(_req, lobby) {
				if (!isRoutableRoom(lobby.name)) {
					return new Response('unknown workspace', { status: 400 });
				}
			},
			// Nothing legitimate reaches a room over plain HTTP — this relay speaks Yjs over
			// WebSocket and nothing else — and letting one through would create the room as a
			// side effect of answering 404.
			onBeforeRequest() {
				return new Response('Not found', { status: 404 });
			}
		});
		if (routed) return routed;
		// A plain 200 on the root keeps readiness checks (and humans) from seeing a 404.
		if (new URL(request.url).pathname === '/') return new Response('syncticket relay');
		return new Response('Not found', { status: 404 });
	}
} satisfies ExportedHandler<Env>;
