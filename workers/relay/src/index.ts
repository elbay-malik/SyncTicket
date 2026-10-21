// The Yjs relay: one hibernating Durable Object per workspace.
//
// It is a separate Worker from the app because the stable adapter-cloudflare cannot export
// Durable Object classes, and Wrangler requires a class's migration to live with the worker
// that defines it (ADR 0002). The browser connects here directly over WebSocket, so the app
// worker never proxies sync traffic.

import { routePartykitRequest, type Connection, type ConnectionContext } from 'partyserver';
import type * as Y from 'yjs';
import { YServer } from 'y-partyserver';
import {
	classifySnapshot,
	countStructs,
	createHealthTableSql,
	createTableSql,
	decodeSnapshot,
	encodePersistenceNotice,
	encodeSnapshot,
	readHealthSql,
	readSnapshotSql,
	writeHealthSql,
	writeSnapshotSql,
	type PersistenceState,
	type PersistFailure,
	type SnapshotSize
} from './storage.js';
import { planLoad, planSave, planWriteError, type PersistPlan } from './persistence-plan.js';
import { isRoutableRoom } from './rooms.js';
import { connectKey, refuseConnect } from './limits.js';

export class YDocRoom extends YServer<Env> {
	// Hibernation is what makes an idle room free: the instance is evicted, its memory with
	// it, and only the WebSockets survive. Everything in the document therefore has to be
	// recoverable from storage below.
	static override options = { hibernate: true };

	// y-partyserver debounces `onSave` on the document's `update` event, and the *trailing*
	// timer — not the ceiling — is the worst case: any gap longer than `debounceWait` fires a
	// write, so bursty human typing costs more than continuous editing does. At the previous
	// 300/2000 that was up to ~288,000 row writes a day for a single room, against an
	// account-wide free-plan budget of 100,000 — one room could exhaust the whole account in
	// about 8.3 hours, which is the second route to exactly the same silent data loss as the
	// 2 MB ceiling. 2000 is y-partyserver's own default trailing value (`CALLBACK_DEFAULTS`,
	// `dist/server/index.js:53-57`); only the 10 s ceiling is tightened, to 5 s. The cost is
	// that up to 5 s of the newest changes live only in evictable memory, which is acceptable
	// because every client holds the whole document in IndexedDB and re-syncs it on connect.
	static override callbackOptions = { debounceWait: 2000, debounceMaxWait: 5000 };

	/** Whether persistence is working, as last decided. Carried to late joiners by `onConnect`. */
	#persist: PersistenceState = 'ok';
	#reason: PersistFailure | undefined;
	/** Latched so the 75% crossing is logged once per excursion, not once per save. */
	#warned = false;
	/** Latches the wake-cost line, which is on its own axis and has its own excursion. */
	#wakeWarned = false;
	#noticeAt = 0;

	override async onLoad(): Promise<Y.Doc | void> {
		this.ctx.storage.sql.exec(createTableSql());
		this.ctx.storage.sql.exec(createHealthTableSql());
		const row = [...this.ctx.storage.sql.exec(readSnapshotSql())][0];
		const doc = decodeSnapshot(row?.doc);
		const health = [...this.ctx.storage.sql.exec(readHealthSql())][0];
		const now = Date.now();
		const loaded = planLoad({
			healthRow: health,
			bytes: encodeSnapshot(doc).byteLength,
			room: this.#roomTag(),
			now
		});
		this.#persist = loaded.state;
		this.#reason = loaded.reason;
		this.#noticeAt = now;
		if (loaded.log) console.error(loaded.log);
		// No broadcast here: there are no connections yet. `onConnect` carries it.
		return doc;
	}

	/**
	 * Writes the snapshot, or decides not to and says so.
	 *
	 * Nothing below can throw, which makes y-partyserver's `onSave().catch(…)` swallow
	 * (`dist/server/index.js:185-195`) unreachable — the whole point, since that swallow is
	 * what made the 2 MB ceiling silent.
	 */
	override async onSave(): Promise<void> {
		// Outside any try: a throw from encoding is a bug in this worker, not a storage
		// failure, and must not be reported to users as degraded persistence.
		const bytes = encodeSnapshot(this.document);
		const size = classifySnapshot(bytes.byteLength);
		// A second, unrelated measurement: what a cold wake would cost. Cheap — the state
		// vector is one clock per client — and not derivable from `bytes`, which is the whole
		// point of measuring it separately.
		const structs = countStructs(this.document);
		// One clock reading for the whole attempt, so the timestamp inside a broadcast notice
		// and the one `onConnect` later re-encodes for a late joiner are the same instant.
		const now = Date.now();
		const plan = planSave({
			bytes: bytes.byteLength,
			size,
			state: this.#persist,
			warned: this.#warned,
			structs,
			wakeWarned: this.#wakeWarned,
			room: this.#roomTag(),
			now
		});
		let applied = plan;
		if (plan.write) {
			try {
				this.ctx.storage.sql.exec(writeSnapshotSql(), bytes);
			} catch (err) {
				applied = planWriteError({
					err,
					bytes: bytes.byteLength,
					state: this.#persist,
					room: this.#roomTag(),
					now
				});
			}
		}
		this.#apply(applied, bytes.byteLength, size, now);
	}

	/**
	 * Carries out a plan's side effects. Edge-triggered: see `persistence-plan.ts`.
	 *
	 * `bytes`, `size` and `now` are the inputs the plan was made from; the plan itself carries
	 * only decisions, and the health row, the warn latch and the stored notice timestamp all
	 * need the raw values.
	 */
	#apply(plan: PersistPlan, bytes: number, size: SnapshotSize, now: number): void {
		this.#persist = plan.next;
		this.#reason = plan.reason;
		// The latch `planSave` reads: set while the snapshot is in the warn band, cleared once
		// it is back under the warn threshold, and left alone while it is over the ceiling
		// (where the degraded notice has already said something louder).
		this.#warned = size === 'ok' ? false : size === 'warn' ? true : this.#warned;
		// Its own latch, on its own axis: a document can shed bytes without shedding structs
		// (gc reclaims deleted *content*, never the tombstones), so clearing this one from the
		// byte size would re-arm a line whose condition has not changed. Only `planSave`
		// setting it latches it; nothing clears it for the life of the room, because structs
		// never decrease.
		if (plan.wakeWarned) this.#wakeWarned = true;
		if (plan.recordHealth) {
			try {
				this.ctx.storage.sql.exec(writeHealthSql(), plan.next, bytes, now, plan.reason ?? null);
			} catch (err) {
				// The rows-per-day exhaustion that kills the snapshot write kills this one too.
				// Losing the marker must not cost us the broadcast below.
				console.error('relay.persistence event=health-write-failed', err);
			}
		}
		if (plan.notice) {
			this.#noticeAt = now;
			this.broadcastCustomMessage(plan.notice);
		}
		if (plan.log) console.error(plan.log);
	}

	/**
	 * Tells a connection about degraded persistence as it arrives.
	 *
	 * Not optional: `broadcastCustomMessage` only reaches sockets that are open when it fires
	 * (`dist/server/index.js:243-262`), so a reload — or a visitor arriving long after the
	 * transition, which on the "discovered months later" path is every visitor, because the
	 * room has since hibernated and been evicted — would otherwise see a healthy UI.
	 *
	 * Synchronous, matching the base method's `(conn, _ctx)` signature; declaring it `async`
	 * fights `noImplicitOverride` and the base return type.
	 */
	override onConnect(conn: Connection, ctx: ConnectionContext): void {
		// Sync step 1 and awareness first (`dist/server/index.js:334-352`), so the client has
		// the document before it is told anything about it.
		super.onConnect(conn, ctx);
		if (this.#persist === 'ok') return;
		this.sendCustomMessage(
			conn,
			encodePersistenceNotice({ state: this.#persist, reason: this.#reason, at: this.#noticeAt })
		);
	}

	/**
	 * The room id as it may appear in a log store.
	 *
	 * The room name *is* the capability — `rooms.ts` is explicit that unguessability is the
	 * access control — so the full 33 characters must never be logged. Eight characters tell
	 * rooms apart and leave ~96 bits unguessable.
	 */
	#roomTag(): string {
		return this.name.slice(0, 8);
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
			async onBeforeConnect(req, lobby) {
				if (!isRoutableRoom(lobby.name)) {
					return new Response('unknown workspace', { status: 400 });
				}
				// After the shape check, so a malformed name costs no limiter call. The name
				// check is only a shape check — a stranger can mint one — so this is what
				// bounds the rate at which empty rooms can be created. It fails open.
				return refuseConnect(env.CONNECT_LIMIT, connectKey(req));
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
