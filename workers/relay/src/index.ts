// The Yjs relay: one hibernating Durable Object per workspace.
//
// It is a separate Worker from the app because the stable adapter-cloudflare cannot export
// Durable Object classes, and Wrangler requires a class's migration to live with the worker
// that defines it (ADR 0002). The browser connects here directly over WebSocket, so the app
// worker never proxies sync traffic.

import { routePartykitRequest } from 'partyserver';
import type * as Y from 'yjs';
import { YServer } from 'y-partyserver';
import {
	createTableSql,
	decodeSnapshot,
	encodeSnapshot,
	readSnapshotSql,
	writeSnapshotSql
} from './storage.js';

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
}

export default {
	async fetch(request, env) {
		// routePartykitRequest is async: awaiting it is what makes the fallback reachable at
		// all, and without a fallback an unmatched path resolves to null, which workerd
		// rejects outright.
		const routed = await routePartykitRequest(request, env);
		if (routed) return routed;
		// A plain 200 on the root keeps readiness checks (and humans) from seeing a 404.
		if (new URL(request.url).pathname === '/') return new Response('syncticket relay');
		return new Response('Not found', { status: 404 });
	}
} satisfies ExportedHandler<Env>;
