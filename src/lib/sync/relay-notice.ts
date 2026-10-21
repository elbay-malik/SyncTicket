// The relay's persistence channel, client half.
//
// The relay can fail to store a workspace while relaying it perfectly: Cloudflare caps a
// SQLite BLOB at 2 MB, and y-partyserver swallows the write error (its debounced save does
// `this.onSave().catch(console.error)`), so the room looks healthy and loses everything
// since the last good write at the next hibernation eviction. This channel is how the room
// says so out loud.
//
// It carries a closed enum, never display text. The UI renders only its own copy keyed by
// `state` and `reason` (see `connectionCopy` in $lib/format.ts), so a malformed — or
// hostile — frame can at worst be ignored.

/*
 * The three types below, and the wire shape `parsePersistenceNotice` accepts, are the same
 * fact as `encodePersistenceNotice` in `workers/relay/src/storage.ts` — written twice on
 * purpose. Change one and you must change the other in the same commit; the pinned literal
 * that appears in both `relay-notice.test.ts` and the relay's `storage.test.ts` is what
 * makes a drift fail the suite rather than silently stop reporting.
 *
 * Duplicated rather than imported for the same reason as `RELAY_PARTY` in `provider.ts`:
 * the relay is a standalone workspace package with its own tsconfig (no DOM lib, no app
 * `Env`) and the app bundle must not pull the relay package in to learn a string union.
 */

/**
 * Whether the relay can still store this workspace.
 *
 * 'ok' — storing normally. 'degraded' — the last save failed, so nothing since it is on the
 * relay. 'stale' — a save failed earlier and the room was evicted, so what the relay holds
 * is older than what was written.
 */
export type PersistenceState = 'ok' | 'degraded' | 'stale';

/** Why a save failed. 'too-big' is the 2 MB row cap; everything else is 'unknown'. */
export type PersistFailure = 'too-big' | 'unknown';

export interface PersistenceNotice {
	state: PersistenceState;
	/** Present only when `state !== 'ok'`. */
	reason?: PersistFailure;
	/** When the relay observed this, in epoch milliseconds. */
	at: number;
}

const NOTICE_VERSION = 1;

const STATES: readonly string[] = ['ok', 'degraded', 'stale'];
const REASONS: readonly string[] = ['too-big', 'unknown'];

/**
 * Parses one frame off the channel, or returns null.
 *
 * Total and strict: it never throws, for any input, and it accepts nothing it does not
 * recognise — the caller's contract is that an unparsable frame is simply ignored. An
 * unrecognised `reason` drops that field rather than the whole notice, because the state is
 * the part the UI must act on and a newer relay is allowed to name a failure this build has
 * never heard of.
 */
export function parsePersistenceNotice(raw: string): PersistenceNotice | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	// `typeof null === 'object'`, and an array passes it too; both are rejected here rather
	// than left to the property reads below, which would happily find `undefined`.
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

	const frame = parsed as Record<string, unknown>;
	if (frame.v !== NOTICE_VERSION) return null;
	if (frame.type !== 'persistence') return null;
	if (typeof frame.state !== 'string' || !STATES.includes(frame.state)) return null;
	// Finite, not merely a number: JSON has no NaN or Infinity literals, but `1e999` parses
	// to Infinity, and an infinite `at` would compare greater than every acknowledgement and
	// pin the notice open forever.
	if (typeof frame.at !== 'number' || !Number.isFinite(frame.at)) return null;

	const notice: PersistenceNotice = { state: frame.state as PersistenceState, at: frame.at };
	if (typeof frame.reason === 'string' && REASONS.includes(frame.reason)) {
		notice.reason = frame.reason as PersistFailure;
	}
	return notice;
}
