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

/** ISO string for <time datetime>; invalid/zero timestamps yield undefined (no attr). */
export function isoTime(timestamp: number): string | undefined {
	return Number.isFinite(timestamp) && timestamp > 0
		? new Date(timestamp).toISOString()
		: undefined;
}
