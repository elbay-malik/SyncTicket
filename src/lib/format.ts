// Presentation-only formatting helpers. Pure functions; `now` is injectable for tests.

import type { PersistFailure, PersistenceState } from '$lib/sync/relay-notice.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/**
 * "just now", "3 minutes ago", "yesterday", "in 2 hours", … Unit thresholds are chosen so
 * the output never reads as spuriously precise (no "0 minutes ago").
 */
export function relativeTime(timestamp: number, now: number = Date.now()): string {
	const delta = timestamp - now;
	const abs = Math.abs(delta);
	if (abs < 45 * SECOND) return 'just now';
	const unit: [number, Intl.RelativeTimeFormatUnit] =
		abs < 45 * MINUTE
			? [MINUTE, 'minute']
			: abs < 22 * HOUR
				? [HOUR, 'hour']
				: abs < 26 * DAY
					? [DAY, 'day']
					: abs < 11 * MONTH
						? [MONTH, 'month']
						: [YEAR, 'year'];
	return relative.format(Math.round(delta / unit[0]), unit[1]);
}

/**
 * "Ada", "Ada and Bob", "Ada, Bob and 2 others" — the readable half of an avatar stack.
 *
 * Avatars are decoration: a ring of coloured initials tells a screen reader nothing, and
 * tells a colour-blind user very little. This sentence is the part that carries the
 * information, so it names as many people as it reasonably can and counts the rest.
 */
export function listNames(names: readonly string[], limit = 3): string {
	if (names.length === 0) return '';
	if (names.length === 1) return names[0] as string;
	if (names.length <= limit) {
		return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
	}
	const rest = names.length - limit;
	return `${names.slice(0, limit).join(', ')} and ${rest} ${rest === 1 ? 'other' : 'others'}`;
}

export interface ConnectionCopy {
	/** Where the data lives. Never claims durability the browser doesn't actually have. */
	stored: string;
	/** Who else has it, and whether that link is currently working. */
	shared: string;
	/**
	 * Whether the relay can still store this workspace — null when it can.
	 *
	 * A third sentence rather than a qualifier on the other two, because it is independent
	 * of both: the socket is up (so `shared` is cheerfully correct) and this browser has
	 * saved everything locally (so `stored` is too), and yet the relay is keeping none of
	 * it. Null in the healthy case on purpose: a workspace with nothing wrong with it must
	 * not gain a reassurance badge, which would train people to stop reading the popover.
	 */
	durable: string | null;
	/**
	 * The same three facts at header size, for the status control's visible label.
	 *
	 * These exist because the sentences above were readable only after clicking an
	 * unlabelled glyph, which meant a visitor who never clicked saw no evidence that this
	 * product stores anything locally or shares anything at all — on a surface whose whole
	 * claim is exactly that. Derived here rather than written in the header so a new
	 * connection state cannot produce a label that disagrees with the sentence beneath it.
	 *
	 * `durable` stays null in the healthy case for the same reason it does above: the
	 * header says what IS true, and invents no badge for the absence of a problem.
	 */
	short: {
		stored: string;
		shared: string;
		durable: string | null;
	};
}

/**
 * The two-sentence status a person actually needs, exhaustive over every combination the
 * app can be in — a local-first document that may or may not be backed by IndexedDB, joined
 * to a relay that may not be configured, reachable, or yet synced, shared with anyone from
 * zero to many.
 *
 * Kept as two sentences rather than one, because they can be independently true or false:
 * a browser that failed to open its database is still perfectly able to talk to a relay
 * (its edits just will not survive a reload), and a browser offline from the relay has
 * still saved everything it did locally.
 */
export function connectionCopy(input: {
	persisted: boolean;
	connection: 'local' | 'offline' | 'connecting' | 'connected';
	relaySynced: boolean;
	/** Other people currently in the workspace — never counts this browser itself. */
	peerCount: number;
	/** What the relay last said about its ability to store this workspace. */
	relayPersistence: PersistenceState;
	/** Why its last save failed; absent while `relayPersistence` is 'ok'. */
	relayPersistenceReason?: PersistFailure;
}): ConnectionCopy {
	const stored = input.persisted
		? 'Saved on this device'
		: 'Not saved — this browser blocked local storage, so changes exist only until you close this tab';

	const shared = (() => {
		switch (input.connection) {
			case 'local':
				return 'Local only — no relay configured';
			case 'offline':
				return "Not shared — you're offline";
			case 'connecting':
				return 'Connecting…';
			case 'connected':
				if (!input.relaySynced) return 'Connected, syncing…';
				if (input.peerCount === 0) return 'Ready to share — no one else here yet';
				if (input.peerCount === 1) return 'Shared with 1 other';
				return `Shared with ${input.peerCount} others`;
		}
	})();

	const durable = (() => {
		switch (input.relayPersistence) {
			case 'ok':
				return null;
			case 'degraded':
				// A browser that cannot save locally either is the one case where this is not
				// just "other people may fall behind" — there is then no copy of this work
				// anywhere that outlives the tab, which is blunter than either reason on its
				// own and so is said regardless of which failure it was.
				if (!input.persisted) {
					return "The relay has stopped saving this workspace, and this browser can't save locally either. Nothing here will survive closing the tab.";
				}
				// 'too-big' is a ceiling that will still be there on the next attempt. 'unknown' is
				// often a failure the relay's own debounced save clears on the next edit, but it
				// also covers a room refusing saves until an operator steps in, and no client can
				// tell the two apart, so it promises no retry (ADR 0010). No byte counts and no
				// error codes — neither is anything the reader can act on.
				return input.relayPersistenceReason === 'too-big'
					? "The relay has stopped saving this workspace — it's full. Your work is still saved in this browser, but other people's copies may fall behind."
					: "The relay's last save failed, so it isn't storing this workspace right now. Your work is still saved in this browser.";
			case 'stale':
				// Past tense, because by the time this is known the loss has already happened:
				// the room was evicted while a save was failing. Nothing the reader does now
				// recovers it, so the sentence tells them what they are looking at instead of
				// asking them to act.
				return "Part of this workspace's history was lost: the relay ran out of room before it could save. What you see is the last copy it managed to keep.";
		}
	})();

	// Short forms. Every one is a compression of the sentence above it, never a different
	// claim: "Saved locally" is the same fact as "Saved on this device", and the browser
	// that blocked storage gets "Not saved" rather than a cheerful default.
	const short = {
		stored: input.persisted ? 'Saved locally' : 'Not saved',
		shared: (() => {
			switch (input.connection) {
				case 'local':
					return 'Local only';
				case 'offline':
					return 'Offline';
				case 'connecting':
					return 'Connecting…';
				case 'connected':
					if (!input.relaySynced) return 'Syncing…';
					if (input.peerCount === 0) return 'Ready to share';
					return `Shared with ${input.peerCount}`;
			}
		})(),
		durable:
			input.relayPersistence === 'ok'
				? null
				: input.relayPersistence === 'stale'
					? 'History lost'
					: 'Not saving'
	};

	return { stored, shared, durable, short };
}

/** ISO string for <time datetime>; invalid/zero timestamps yield undefined (no attr). */
export function isoTime(timestamp: number): string | undefined {
	if (!(timestamp > 0)) return undefined;
	const date = new Date(timestamp);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
