// The Yjs relay: one hibernating Durable Object per workspace.
//
// It is a separate Worker from the app because the stable adapter-cloudflare cannot export
// Durable Object classes, and Wrangler requires a class's migration to live with the worker
// that defines it (ADR 0002). The browser connects here directly over WebSocket, so the app
// worker never proxies sync traffic.

import {
	routePartykitRequest,
	type Connection,
	type ConnectionContext,
	type WSMessage
} from 'partyserver';
import * as Y from 'yjs';
import { YServer } from 'y-partyserver';
import {
	countStructs,
	createHealthTableSql,
	createQuarantineTableSql,
	createTableSql,
	decodeSnapshot,
	encodePersistenceNotice,
	errorText,
	prepareSnapshot,
	quarantineSnapshot,
	readHealthSql,
	readSnapshotSql,
	UNREADABLE_REASON,
	writeHealthSql,
	writeSnapshotSql,
	type PersistenceState,
	type PersistFailure,
	type SnapshotSize,
	type StoredSnapshot
} from './storage.js';
import {
	planDamagedLoad,
	planLoad,
	planSave,
	planWriteError,
	type PersistPlan
} from './persistence-plan.js';
import { isBlockedRoom, isRoutableRoom } from './rooms.js';
import { ROOM_TTL_MS, nextExpiry, onExpiry } from './expiry.js';
import { connectKey, refuseConnect, screenUpgrade } from './limits.js';
import {
	admitFrame,
	encodeAwarenessFrame,
	encodeSyncStep1,
	newConnectionLimits,
	type AwarenessEntry,
	type ConnectionLimits
} from './message-limits.js';

/** Where y-partyserver keeps the presence ids a connection holds (`dist/server/index.js:28`). */
const AWARENESS_IDS_KEY = '__ypsAwarenessIds';

function heldIds(conn: Connection): number[] {
	try {
		const ids = (conn.state as Record<string, unknown> | null)?.[AWARENESS_IDS_KEY];
		return Array.isArray(ids) ? ids.filter((id): id is number => typeof id === 'number') : [];
	} catch {
		return [];
	}
}

/**
 * Set once a connection has sent its first presence frame, its one chance to claim a client
 * (`claimEntries`). Kept beside y-partyserver's ids in the socket's attachment, so it survives
 * hibernation as they do.
 */
const CLAIMED_KEY = '__stPresenceClaimed';

function claimedBefore(conn: Connection): boolean {
	try {
		return (conn.state as Record<string, unknown> | null)?.[CLAIMED_KEY] === true;
	} catch {
		return false;
	}
}

function updateState(conn: Connection, patch: Record<string, unknown>): void {
	try {
		conn.setState((prev: unknown) => ({ ...(prev as Record<string, unknown> | null), ...patch }));
	} catch {
		// The connection is going; y-partyserver's own bookkeeping does the same.
	}
}

function setHeldIds(conn: Connection, ids: number[]): void {
	updateState(conn, { [AWARENESS_IDS_KEY]: ids });
}

export class YDocRoom extends YServer<Env> {
	// Hibernation is what makes an idle room free: the instance is evicted, its memory with
	// it, and only the WebSockets survive. Everything in the document therefore has to be
	// recoverable from storage below.
	static override options = { hibernate: true };

	// y-partyserver debounces `onSave` on the document's `update` event, and the *trailing*
	// timer is the worst case: any gap longer than `debounceWait` fires a write. At its own
	// 2000/10000, or this file's earlier 2000/5000, a client sending one small update just over
	// every two seconds cost a row write each time, about 43,000 a day for one room against an
	// account-wide free-plan budget of 100,000. At 5000/15000 one room costs at most one write
	// per five seconds, about 17,000 a day, and ordinary typing far fewer. The cost is that up to
	// 15 s of the newest changes live only in evictable memory, which is acceptable because every
	// client holds the whole document in IndexedDB and re-syncs it on connect.
	static override callbackOptions = { debounceWait: 5000, debounceMaxWait: 15000 };

	/** Whether persistence is working, as last decided. Carried to late joiners by `onConnect`. */
	#persist: PersistenceState = 'ok';
	#reason: PersistFailure | undefined;
	/** Latched so the 75% crossing is logged once per excursion, not once per save. */
	#warned = false;
	/** Latches the wake-cost line, which is on its own axis and has its own excursion. */
	#wakeWarned = false;
	#noticeAt = 0;
	/** A damaged row is still in the way of id=1, so no save may overwrite it. See `onLoad`. */
	#refuseSaves = false;
	/**
	 * Set once the room's storage has been deleted by `onAlarm`, until the next save puts its
	 * tables back. The document stays in memory until the instance is evicted, so someone who
	 * connects in that window still gets it, and their next save keeps the room: someone is
	 * using it after all.
	 */
	#expired = false;
	/**
	 * Per-connection message limits, in memory (see `message-limits.ts` for why that is enough).
	 * A connection that lived through a hibernation starts again with a full budget.
	 *
	 * Keyed by the socket, not `conn.id`: the client sends the same id on every reconnect, so a
	 * tab's new socket and its old one, not yet noticed as dead, share one. Keyed by id, the new
	 * socket inherited the old one's limits and could have its first sync request dropped.
	 */
	#limits = new WeakMap<Connection, ConnectionLimits>();

	/**
	 * Every frame passes `admitFrame` before y-partyserver sees it. See `message-limits.ts` for
	 * what is let through and why.
	 */
	override onMessage(conn: Connection, message: WSMessage): void {
		const now = Date.now();
		let limits = this.#limits.get(conn);
		if (!limits) {
			limits = newConnectionLimits(now);
			this.#limits.set(conn, limits);
		}
		const presence = { held: heldIds(conn), claimedBefore: claimedBefore(conn) };
		const verdict = admitFrame(message, limits, presence, now);
		if (verdict.action !== 'close' && verdict.presenceFrame && !presence.claimedBefore) {
			updateState(conn, { [CLAIMED_KEY]: true });
		}
		if (verdict.action === 'drop') return;
		if (verdict.action === 'close') {
			try {
				conn.close(verdict.code, verdict.reason);
			} catch {
				// Already closing.
			}
			return;
		}
		if (verdict.claimed != null) {
			// Recorded here, not left to y-partyserver: it only records ids the room has never
			// seen, and a tab reconnecting without a reload brings back an id the room has seen.
			setHeldIds(conn, [verdict.claimed]);
			this.#takePresence(conn, verdict.claimed);
		}
		super.onMessage(conn, verdict.frame);
	}

	/**
	 * Gives `clientId` to `conn`, taking it from any other connection that held it: the old
	 * socket of a tab that has reconnected before its death was noticed. Without the move, both
	 * sockets would claim the id, and the old one closing would clear the reconnected tab's
	 * presence.
	 */
	#takePresence(conn: Connection, clientId: number): void {
		for (const other of this.getConnections()) {
			// The socket itself, not its id: the stale socket this is for has the same id.
			if (other === conn) continue;
			const ids = heldIds(other);
			if (ids.includes(clientId))
				setHeldIds(
					other,
					ids.filter((id) => id !== clientId)
				);
		}
	}

	/** The client never sends custom messages, and the base method logs each one in full. */
	override onCustomMessage(): void {}

	override onClose(conn: Connection, code: number, reason: string, wasClean: boolean): void {
		this.#limits.delete(conn);
		super.onClose(conn, code, reason, wasClean);
	}

	override async onLoad(): Promise<Y.Doc | void> {
		this.ctx.storage.sql.exec(createTableSql());
		this.ctx.storage.sql.exec(createHealthTableSql());
		this.#createQuarantineTable();
		const row = [...this.ctx.storage.sql.exec(readSnapshotSql())][0];
		const snapshot = decodeSnapshot(row?.doc);
		const health = [...this.ctx.storage.sql.exec(readHealthSql())][0];
		const now = Date.now();
		if (snapshot.status === 'damaged') {
			this.#setAsideDamaged(snapshot, health, now);
			await this.#armExpiry(now);
			return snapshot.doc;
		}
		const loaded = planLoad({
			healthRow: health,
			bytes: snapshot.byteLength,
			room: this.#roomTag(),
			now
		});
		this.#persist = loaded.state;
		this.#reason = loaded.reason;
		this.#noticeAt = loaded.at ?? now;
		if (loaded.log) console.error(loaded.log);
		// A room that is opened and never saved into still expires: that is most of what a
		// stranger minting rooms would leave behind.
		await this.#armExpiry(now);
		// No broadcast: this repeats on every wake, and a socket that lived through the hibernation
		// has already been told. `onConnect` carries it to anyone arriving.
		return snapshot.doc;
	}

	/** The room's term, overridable for a local check of expiry (`wrangler dev --var`). */
	#ttl(): number {
		const configured = Number((this.env as { ROOM_TTL_MS?: string }).ROOM_TTL_MS);
		return Number.isFinite(configured) && configured > 0 ? configured : ROOM_TTL_MS;
	}

	/** Sets or moves the room's expiry alarm. A failure only costs this one re-arm. */
	async #armExpiry(now: number): Promise<void> {
		try {
			const at = nextExpiry(now, await this.ctx.storage.getAlarm(), this.#ttl());
			if (at !== null) await this.ctx.storage.setAlarm(at);
		} catch (err) {
			console.error(`relay.expiry event=arm-failed room=${this.#roomTag()}`, errorText(err));
		}
	}

	/**
	 * The room's term is up: 30 days since it was last opened or saved into. See `expiry.ts`. Everything goes, including the health row and any
	 * quarantined snapshot (ADR 0010): a room nobody has used in that long has nobody to report
	 * them to.
	 */
	override async onAlarm(): Promise<void> {
		const now = Date.now();
		const decision = onExpiry([...this.getConnections()].length, now, this.#ttl());
		if (decision.action === 'postpone') {
			await this.ctx.storage.setAlarm(decision.until);
			return;
		}
		await this.ctx.storage.deleteAlarm();
		await this.ctx.storage.deleteAll();
		this.#expired = true;
		this.#persist = 'ok';
		this.#reason = undefined;
		this.#refuseSaves = false;
		this.#warned = false;
		console.log(`relay.expiry event=expired room=${this.#roomTag()}`);
	}

	/**
	 * Allowed to fail, unlike the two CREATEs before it.
	 *
	 * For a room that already has a snapshot this is a real schema write on its first wake after the
	 * deploy that added the table, where theirs are no-ops, and that wake may fall inside an exhausted
	 * write budget. A healthy room does not need the table to start, and without it a damaged row is
	 * refused by `quarantineSnapshot` like any other failed move, so the row stays and the next wake
	 * tries again.
	 */
	#createQuarantineTable(): void {
		try {
			this.ctx.storage.sql.exec(createQuarantineTableSql());
		} catch (err) {
			console.error(
				`relay.persistence event=quarantine-table-failed room=${this.#roomTag()}`,
				errorText(err)
			);
		}
	}

	/**
	 * Keeps a damaged row from the save that would otherwise replace it.
	 *
	 * The room still starts, empty, because throwing from `onLoad` would leave it unable to serve
	 * and the clients re-seed it from IndexedDB on connect. If the row could not be moved, it stays
	 * where it is and no save this instance makes may write over it.
	 */
	#setAsideDamaged(
		snapshot: Extract<StoredSnapshot, { status: 'damaged' }>,
		health: unknown,
		now: number
	): void {
		let outcome: ReturnType<typeof quarantineSnapshot> | 'write-failed';
		try {
			outcome = quarantineSnapshot(this.ctx.storage, snapshot, now);
		} catch (err) {
			outcome = 'write-failed';
			console.error(
				`relay.persistence event=quarantine-write-error room=${this.#roomTag()}`,
				errorText(err)
			);
		}
		const plan = planDamagedLoad({
			outcome,
			healthRow: health,
			bytes: snapshot.byteLength,
			room: this.#roomTag(),
			now
		});
		this.#persist = plan.state;
		this.#reason = plan.reason;
		this.#noticeAt = plan.at;
		this.#refuseSaves = plan.refuseSaves;
		if (plan.recordHealth) {
			this.#writeHealth(plan.state, snapshot.byteLength, now, UNREADABLE_REASON);
		}
		// Unlike a stale wake this is news, and sockets that lived through the hibernation are
		// open already: `onConnect` only runs for new ones.
		if (plan.notice) this.broadcastCustomMessage(plan.notice);
		if (plan.log) console.error(plan.log);
	}

	/**
	 * Writes the snapshot, or decides not to and says so.
	 *
	 * Nothing may get out of here, because y-partyserver's `onSave().catch(…)`
	 * (`dist/server/index.js:185-195`) would swallow it, which is what made the 2 MB ceiling
	 * silent. That includes encoding. It looks like it could only fail on a bug in this worker, but
	 * the document's state belongs to whoever holds the link, so a throw there is exactly a room
	 * that can no longer be saved, and it gets reported like any other.
	 */
	override async onSave(): Promise<void> {
		// One clock reading for the whole attempt, so the timestamp inside a broadcast notice
		// and the one `onConnect` later re-encodes for a late joiner are the same instant.
		const now = Date.now();
		try {
			if (this.#expired) {
				// Someone came back before the instance was evicted. Their room starts again, with
				// a term of its own even if the save below is refused.
				this.ctx.storage.sql.exec(createTableSql());
				this.ctx.storage.sql.exec(createHealthTableSql());
				this.#createQuarantineTable();
				this.#expired = false;
				await this.#armExpiry(now);
			}
			const { bytes, size, unreadable } = prepareSnapshot(this.document);
			// A second, unrelated measurement: what a cold wake would cost. Cheap — the state
			// vector is one clock per client — and not derivable from `bytes`, which is the whole
			// point of measuring it separately.
			const structs = countStructs(this.document);
			const plan = planSave({
				bytes: bytes.byteLength,
				size,
				refused: unreadable || this.#refuseSaves,
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
					await this.#armExpiry(now);
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
		} catch (err) {
			// Nothing known reaches this. It keeps the promise above if something ever does, and
			// the inner catch keeps it if reporting was the part that broke.
			console.error('relay.persistence event=save-crashed', errorText(err));
			try {
				const plan = planSave({
					bytes: 0,
					size: 'ok',
					refused: true,
					state: this.#persist,
					warned: this.#warned,
					structs: 0,
					wakeWarned: this.#wakeWarned,
					room: this.#roomTag(),
					now
				});
				this.#apply(plan, 0, 'ok', now);
			} catch (reporting) {
				console.error('relay.persistence event=save-crashed', errorText(reporting));
			}
		}
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
			this.#writeHealth(plan.next, bytes, now, plan.healthReason ?? plan.reason ?? null);
		}
		if (plan.notice) {
			this.#noticeAt = now;
			this.broadcastCustomMessage(plan.notice);
		}
		if (plan.log) console.error(plan.log);
	}

	#writeHealth(state: PersistenceState, bytes: number, now: number, reason: string | null): void {
		try {
			this.ctx.storage.sql.exec(writeHealthSql(), state, bytes, now, reason);
		} catch (err) {
			// The rows-per-day exhaustion that kills the snapshot write kills this one too.
			// Losing the marker must not cost us the broadcast that follows.
			console.error('relay.persistence event=health-write-failed', err);
		}
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
		// A room whose storage expired while its document was still in memory, and someone is back.
		// Their tab may hold nothing the room lacks, and then nothing would ever save, so the room
		// is written back now rather than left empty for whoever comes next.
		if (this.#expired) void this.onSave();
		try {
			super.onConnect(conn, ctx);
		} catch (err) {
			// Encoding the presence states it holds is the part that can throw. A throw here
			// reaches partyserver, which refuses the connection and sends the stack trace to the
			// client, so one bad state would lock everyone new out of the room.
			console.error(`relay.connect event=setup-failed room=${this.#roomTag()}`, errorText(err));
			this.#connectWithoutBadStates(conn);
		}
		if (this.#persist === 'ok') return;
		this.sendCustomMessage(
			conn,
			encodePersistenceNotice({ state: this.#persist, reason: this.#reason, at: this.#noticeAt })
		);
	}

	/** What `super.onConnect` sends, built state by state so a state that cannot be sent is left out. */
	#connectWithoutBadStates(conn: Connection): void {
		conn.send(encodeSyncStep1(Y.encodeStateVector(this.document)));
		const awareness = this.document.awareness;
		const entries: AwarenessEntry[] = [];
		for (const [clientId, state] of awareness.getStates()) {
			try {
				const clock = awareness.meta.get(clientId)?.clock ?? 0;
				entries.push({ clientId, clock, json: JSON.stringify(state) });
			} catch {
				// Left out: this is the state that made the ordinary path throw.
			}
		}
		if (entries.length > 0) conn.send(encodeAwarenessFrame(entries));
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
				if (isBlockedRoom(lobby.name, (env as { BLOCKED_ROOMS?: string }).BLOCKED_ROOMS)) {
					return new Response('workspace removed', { status: 410 });
				}
				// The rest of the request, before anything is counted: where it comes from, and
				// whether it is shaped like the app's own. See `screenUpgrade`.
				const screened = screenUpgrade(req, env.ALLOWED_ORIGINS);
				if (screened instanceof Response) return screened;
				// After the shape checks, so a malformed request costs no limiter call. The name
				// check is only a shape check — a stranger can mint one — so this is what
				// bounds the rate at which empty rooms can be created. It fails open.
				return (await refuseConnect(env.CONNECT_LIMIT, connectKey(req))) ?? screened;
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
