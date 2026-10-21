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
	classifyWriteError,
	encodePersistenceNotice,
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
	state: PersistenceState;
	warned: boolean;
	room: string;
	now: number;
}): PersistPlan {
	const { bytes, size, state, warned, room, now } = input;

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
			return {
				write: false,
				next: state,
				reason: 'too-big',
				notice: null,
				log: null,
				recordHealth: false
			};
		}
		return {
			write: false,
			next: 'degraded',
			reason: 'too-big',
			notice: encodePersistenceNotice({ state: 'degraded', reason: 'too-big', at: now }),
			log: line('degraded', room, bytes, ' reason=too-big'),
			recordHealth: true
		};
	}

	// A successful save is what clears both 'degraded' and the latched 'stale', and the
	// health row is rewritten to 'ok' so the next cold start does not re-announce it.
	if (state !== 'ok') {
		return {
			write: true,
			next: 'ok',
			notice: encodePersistenceNotice({ state: 'ok', at: now }),
			log: line('recovered', room, bytes),
			recordHealth: true
		};
	}

	// 75% is not a user-facing fact — there is nothing for a user to do about it and nothing
	// has been lost — so the crossing is logged once and no further. The caller latches
	// `warned` and clears it when the size is back to 'ok'.
	if (size === 'warn' && !warned) {
		return {
			write: true,
			next: 'ok',
			notice: null,
			log: line('warn', room, bytes),
			recordHealth: false
		};
	}

	return { write: true, next: 'ok', notice: null, log: null, recordHealth: false };
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
} {
	const { healthRow, bytes, room, now } = input;
	const row = healthRow as { state?: unknown; at?: unknown; reason?: unknown } | null | undefined;
	const state = typeof row?.state === 'string' ? row.state : null;
	if (state !== 'degraded' && state !== 'stale') {
		return { state: 'ok', notice: null, log: null };
	}
	// The stored reason is carried through when it is one we know; a row written by some
	// future version is reported as 'unknown' rather than guessed at.
	const reason: PersistFailure = row?.reason === 'too-big' ? 'too-big' : 'unknown';
	// The STORED `at`, not `now`. `at` identifies the failure, and the client compares it
	// against what the viewer has dismissed — so minting a fresh one on every hibernation wake
	// would un-dismiss the banner for a condition that has not changed. A row written before
	// `at` was trustworthy falls back to `now`, which is wrong only once.
	const at = typeof row?.at === 'number' && Number.isFinite(row.at) ? row.at : now;
	return {
		state: 'stale',
		reason,
		notice: encodePersistenceNotice({ state: 'stale', reason, at }),
		log: line('stale-load', room, bytes, ` since=${iso(row?.at, now)}`)
	};
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
