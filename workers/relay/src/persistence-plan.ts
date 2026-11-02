// Deciding what a save attempt should *say*, separately from doing it.
//
// The relay's storage failure mode is silence (see `storage.ts`), and the obvious fix —
// notice the write failed, log it, record it, tell the clients — becomes its own problem if
// it fires on every attempt: the saves that overflow a room are the same saves that repeat
// every few seconds, which is 43,200 log lines and row writes a day for one stuck room. So
// every output here is edge-triggered, and this module is the place that knows it.
//
// Pure on purpose: no `cloudflare:` imports, no clock of its own (`now` is a parameter), no
// storage access. The adapter in `index.ts` does the SQL and holds the latches; everything
// that can be reasoned about is decided here, where plain-Node tests can enumerate it.

import {
	WAKE_WARN_STRUCTS,
	approxWakeMs,
	classifyWriteError,
	encodePersistenceNotice,
	UNREADABLE_REASON,
	type PersistenceState,
	type PersistFailure,
	type SnapshotSize
} from './storage.js';

export interface PersistPlan {
	write: boolean;
	next: PersistenceState;
	reason?: PersistFailure;
	/** An encoded notice to broadcast — non-null ONLY on a transition. */
	notice: string | null;
	/** A line to log — non-null ONLY on a transition or a warn crossing. */
	log: string | null;
	/** Whether to write the health row — ONLY on a transition. */
	recordHealth: boolean;
	/** What the health row should store instead of `reason`, which is what goes on the wire. */
	healthReason?: typeof UNREADABLE_REASON;
	/** Set once the wake-cost line has been emitted, so the caller can latch it. */
	wakeWarned?: boolean;
}

/**
 * Builds one log line. Every line is prefixed `relay.persistence` so a single saved Workers
 * Logs query finds all of them.
 *
 * `room` is expected to arrive already truncated (`index.ts`'s `#roomTag`): the full
 * 33-character room name *is* the capability — `rooms.ts` is explicit that unguessability is
 * the access control — so it must never reach a log store.
 */
function line(event: string, room: string, bytes: number, extra = ''): string {
	return `relay.persistence event=${event} room=${room} bytes=${bytes}${extra}`;
}

/** Decides a save attempt from the snapshot's size and the room's current state. */
export function planSave(input: {
	bytes: number;
	size: SnapshotSize;
	/** This save must not write: its bytes will not reload, or this instance is refusing saves. */
	refused: boolean;
	state: PersistenceState;
	warned: boolean;
	/** Structs in the document — the wake-cost axis, independent of `bytes`. */
	structs: number;
	/** Whether the wake-cost line has already been logged for this excursion. */
	wakeWarned: boolean;
	room: string;
	now: number;
}): PersistPlan {
	const { bytes, size, refused, state, warned, structs, wakeWarned, room, now } = input;

	// Reported before anything else and independently of everything else: a document can be
	// expensive to wake while nowhere near the byte ceiling, and vice versa. `wakeLog` is
	// merged into whichever plan is returned below rather than short-circuiting, because the
	// two conditions are unrelated and a room can cross both on the same save.
	const wakeLog =
		structs > WAKE_WARN_STRUCTS && !wakeWarned
			? `relay.persistence event=wake-cost room=${room} structs=${structs} approx_ms=${approxWakeMs(structs)}`
			: null;
	const withWake = (plan: PersistPlan): PersistPlan =>
		wakeLog === null
			? plan
			: { ...plan, log: plan.log === null ? wakeLog : `${plan.log}\n${wakeLog}`, wakeWarned: true };

	if (size === 'over') {
		// Already failing: total silence. This is the rule that keeps the fix from becoming
		// the rows-and-logs-per-day problem it exists to avoid.
		//
		// The test is `!== 'ok'`, not `=== 'degraded'`, and that distinction is the whole
		// correctness of the latch. `planLoad` re-derives a stored failure as 'stale', and
		// `hibernate: true` means `onLoad` runs on every wake — so a guard that only
		// recognised 'degraded' would see 'stale' as a fresh transition on the next edit after
		// every single wake: rewrite the health row, log, and broadcast a notice with a new
		// `at`. A room edited every 30 s wakes ~2,880 times a day, which is ~2,880 row writes
		// and ~5,760 log lines a day against the budget this exists to defend, 'stale' never
		// latching, and the user's dismissed banner reappearing on every cycle.
		//
		// `next: state` rather than 'degraded' for the same reason: 'stale' is the stronger
		// statement (the stored snapshot is known-incomplete, not merely un-updated) and
		// nothing here learns anything that would justify weakening it.
		if (state !== 'ok') {
			// `withWake` even here, where everything else is silent: the wake cost is a
			// different axis and a crossing on it is new information. Dropping it in the
			// degraded state would hide the one failure that has no graceful degradation,
			// because a room must load in order to serve at all.
			return withWake({
				write: false,
				next: state,
				reason: 'too-big',
				notice: null,
				log: null,
				recordHealth: false
			});
		}
		return withWake({
			write: false,
			next: 'degraded',
			reason: 'too-big',
			notice: encodePersistenceNotice({ state: 'degraded', reason: 'too-big', at: now }),
			log: line('degraded', room, bytes, ' reason=too-big'),
			recordHealth: true
		});
	}

	// Silent while already failing, for the reason spelled out above. 'unknown' on the wire because
	// the copy for it is true here and needs no client change (see `planLoad`).
	if (refused) {
		if (state !== 'ok') {
			return withWake({
				write: false,
				next: state,
				reason: 'unknown',
				notice: null,
				log: null,
				recordHealth: false
			});
		}
		return withWake({
			write: false,
			next: 'degraded',
			reason: 'unknown',
			healthReason: UNREADABLE_REASON,
			notice: encodePersistenceNotice({ state: 'degraded', reason: 'unknown', at: now }),
			log: line('degraded', room, bytes, ` reason=${UNREADABLE_REASON}`),
			recordHealth: true
		});
	}

	// A successful save is what clears both 'degraded' and the latched 'stale', and the
	// health row is rewritten to 'ok' so the next cold start does not re-announce it.
	if (state !== 'ok') {
		return withWake({
			write: true,
			next: 'ok',
			notice: encodePersistenceNotice({ state: 'ok', at: now }),
			log: line('recovered', room, bytes),
			recordHealth: true
		});
	}

	// 75% is not a user-facing fact — there is nothing for a user to do about it and nothing
	// has been lost — so the crossing is logged once and no further. The caller latches
	// `warned` and clears it when the size is back to 'ok'.
	if (size === 'warn' && !warned) {
		return withWake({
			write: true,
			next: 'ok',
			notice: null,
			log: line('warn', room, bytes),
			recordHealth: false
		});
	}

	return withWake({ write: true, next: 'ok', notice: null, log: null, recordHealth: false });
}

/** Decides what a write that threw anyway should say. */
export function planWriteError(input: {
	err: unknown;
	bytes: number;
	state: PersistenceState;
	room: string;
	now: number;
}): PersistPlan {
	const { err, bytes, state, room, now } = input;
	const reason = classifyWriteError(err);
	// A repeat failure while already degraded is silent, for the same reason as above.
	if (state === 'degraded') {
		return { write: false, next: 'degraded', reason, notice: null, log: null, recordHealth: false };
	}
	return {
		write: false,
		next: 'degraded',
		reason,
		notice: encodePersistenceNotice({ state: 'degraded', reason, at: now }),
		log: line('degraded', room, bytes, ` reason=${reason}`),
		recordHealth: true
	};
}

/**
 * Reads the health row at startup.
 *
 * A room that was degraded before the eviction comes back as 'stale': the snapshot on disk
 * is older than what the clients last had, and we cannot know by how much. The state latches
 * and is cleared only by a save that succeeds, which rewrites the row to 'ok'.
 *
 * Anything unreadable — a missing row, null, a wrong shape, an unrecognised state — reports
 * 'ok' silently. That is the same "start rather than refuse to start" posture
 * `decodeSnapshot` already takes: a health marker we cannot parse is not evidence of loss.
 */
export function planLoad(input: { healthRow: unknown; bytes: number; room: string; now: number }): {
	state: PersistenceState;
	reason?: PersistFailure;
	notice: string | null;
	log: string | null;
	/** The stored timestamp to carry to clients, on the one path that uses it so far. */
	at?: number;
} {
	const { healthRow, bytes, room, now } = input;
	const row = healthRow as { state?: unknown; at?: unknown; reason?: unknown } | null | undefined;
	const state = typeof row?.state === 'string' ? row.state : null;
	if (state !== 'degraded' && state !== 'stale') {
		return { state: 'ok', notice: null, log: null };
	}
	// Reported as still failing rather than 'stale', whose copy says the relay ran out of room,
	// which is not what happened here. 'degraded' with 'unknown' tells the reader the true part:
	// the relay isn't storing this and their copy is safe. Silent, since this was announced when it
	// happened and it would otherwise repeat on every hibernation wake.
	if (row?.reason === UNREADABLE_REASON) {
		const at = storedAt(row.at, now);
		return {
			state: 'degraded',
			reason: 'unknown',
			notice: encodePersistenceNotice({ state: 'degraded', reason: 'unknown', at }),
			log: null,
			at
		};
	}
	// The stored reason is carried through when it is one we know; a row written by some
	// future version is reported as 'unknown' rather than guessed at.
	const reason: PersistFailure = row?.reason === 'too-big' ? 'too-big' : 'unknown';
	// The STORED `at`, not `now`. `at` identifies the failure, and the client compares it
	// against what the viewer has dismissed — so minting a fresh one on every hibernation wake
	// would un-dismiss the banner for a condition that has not changed. A row written before
	// `at` was trustworthy falls back to `now`, which is wrong only once.
	const at = storedAt(row?.at, now);
	return {
		state: 'stale',
		reason,
		notice: encodePersistenceNotice({ state: 'stale', reason, at }),
		log: line('stale-load', room, bytes, ` since=${iso(row?.at, now)}`)
	};
}

/**
 * Decides what a wake that found a damaged snapshot should say, once `quarantineSnapshot` has run.
 *
 * Moving the row can only happen once, so that announces unconditionally. The other two outcomes
 * leave the row in place to be found again on every wake, so they announce once and latch on the
 * health row, which is also why `at` is the stored one after the first. If the health row cannot be
 * written either, nothing can hold the latch: the room then announces on every wake, which is
 * bounded by the wakes and is the honest report of a room that can write nothing at all.
 *
 * `refuseSaves` is for the life of this instance: the row is still in the way, and the next wake
 * tries again.
 */
export function planDamagedLoad(input: {
	outcome: 'quarantined' | 'occupied' | 'write-failed';
	healthRow: unknown;
	bytes: number;
	room: string;
	now: number;
}): {
	state: PersistenceState;
	reason: PersistFailure;
	at: number;
	notice: string | null;
	log: string | null;
	recordHealth: boolean;
	refuseSaves: boolean;
} {
	const { outcome, healthRow, bytes, room, now } = input;
	const announce = (log: string, at: number) => ({
		state: 'degraded' as const,
		reason: 'unknown' as const,
		at,
		notice: encodePersistenceNotice({ state: 'degraded', reason: 'unknown', at }),
		log
	});
	if (outcome === 'quarantined') {
		// The transaction that moved the row wrote the health row with it.
		return {
			...announce(line('quarantined', room, bytes), now),
			recordHealth: false,
			refuseSaves: false
		};
	}
	const row = healthRow as { state?: unknown; at?: unknown; reason?: unknown } | null | undefined;
	if (row?.reason === UNREADABLE_REASON) {
		return {
			state: 'degraded',
			reason: 'unknown',
			at: storedAt(row.at, now),
			notice: null,
			log: null,
			recordHealth: false,
			refuseSaves: true
		};
	}
	return {
		...announce(line('quarantine-failed', room, bytes, ` reason=${outcome} saves=refused`), now),
		recordHealth: true,
		refuseSaves: true
	};
}

function storedAt(at: unknown, fallback: number): number {
	return typeof at === 'number' && Number.isFinite(at) ? at : fallback;
}

/**
 * `at` comes back out of SQLite and is only typed by convention, so it could be NaN or a
 * millisecond count outside the Date range — both of which make `toISOString` throw. A
 * startup that cannot format a timestamp must still start.
 */
function iso(at: unknown, fallback: number): string {
	for (const value of [at, fallback]) {
		if (typeof value !== 'number') continue;
		try {
			return new Date(value).toISOString();
		} catch {
			continue;
		}
	}
	return 'unknown';
}
