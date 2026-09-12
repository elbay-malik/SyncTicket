// Presentation-only formatting helpers. Pure functions; `now` is injectable for tests.

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

	return { stored, shared };
}

/** ISO string for <time datetime>; invalid/zero timestamps yield undefined (no attr). */
export function isoTime(timestamp: number): string | undefined {
	return Number.isFinite(timestamp) && timestamp > 0
		? new Date(timestamp).toISOString()
		: undefined;
}
