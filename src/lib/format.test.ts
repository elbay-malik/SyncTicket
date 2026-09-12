import { describe, expect, it } from 'vitest';
import { isoTime, relativeTime, listNames, connectionCopy } from './format.js';

const NOW = Date.UTC(2026, 8, 5, 12, 0, 0);
const s = (n: number) => n * 1000;
const m = (n: number) => s(60 * n);
const h = (n: number) => m(60 * n);
const d = (n: number) => h(24 * n);

describe('relativeTime', () => {
	it('collapses anything under 45 s into "just now"', () => {
		expect(relativeTime(NOW, NOW)).toBe('just now');
		expect(relativeTime(NOW - s(44), NOW)).toBe('just now');
		expect(relativeTime(NOW + s(30), NOW)).toBe('just now');
	});

	it('scales through minutes, hours, days, months, years', () => {
		expect(relativeTime(NOW - m(3), NOW)).toBe('3 minutes ago');
		expect(relativeTime(NOW - h(5), NOW)).toBe('5 hours ago');
		expect(relativeTime(NOW - d(1), NOW)).toBe('yesterday');
		expect(relativeTime(NOW - d(12), NOW)).toBe('12 days ago');
		expect(relativeTime(NOW - d(60), NOW)).toBe('2 months ago');
		expect(relativeTime(NOW - d(800), NOW)).toBe('2 years ago');
	});

	it('handles future timestamps', () => {
		expect(relativeTime(NOW + h(2), NOW)).toBe('in 2 hours');
	});
});

describe('isoTime', () => {
	it('formats valid timestamps and rejects zero/invalid ones', () => {
		expect(isoTime(NOW)).toBe('2026-09-05T12:00:00.000Z');
		expect(isoTime(0)).toBeUndefined();
		expect(isoTime(Number.NaN)).toBeUndefined();
	});
});

describe('listNames', () => {
	it('reads as a sentence rather than a comma-separated dump', () => {
		expect(listNames([])).toBe('');
		expect(listNames(['Ada'])).toBe('Ada');
		expect(listNames(['Ada', 'Grace'])).toBe('Ada and Grace');
		expect(listNames(['Ada', 'Grace', 'Alan'])).toBe('Ada, Grace and Alan');
	});

	it('counts the people it does not have room to name', () => {
		expect(listNames(['Ada', 'Grace', 'Alan', 'Edsger'])).toBe('Ada, Grace, Alan and 1 other');
		expect(listNames(['Ada', 'Grace', 'Alan', 'Edsger', 'Barbara'])).toBe(
			'Ada, Grace, Alan and 2 others'
		);
	});

	it('honours a tighter limit, for the small stacks on a list row', () => {
		expect(listNames(['Ada', 'Grace', 'Alan'], 2)).toBe('Ada, Grace and 1 other');
	});
});

describe('connectionCopy', () => {
	const base = { persisted: true, relaySynced: false, peerCount: 0 } as const;

	it('never claims durability a blocked database does not have', () => {
		expect(connectionCopy({ ...base, connection: 'local' }).stored).toBe('Saved on this device');
		expect(connectionCopy({ ...base, persisted: false, connection: 'local' }).stored).toMatch(
			/not saved/i
		);
	});

	it('is exhaustive over every connection state, including connected+synced+alone', () => {
		expect(connectionCopy({ ...base, connection: 'local' }).shared).toMatch(/local only/i);
		expect(connectionCopy({ ...base, connection: 'offline' }).shared).toMatch(/not shared/i);
		expect(connectionCopy({ ...base, connection: 'connecting' }).shared).toMatch(/connecting/i);
		expect(connectionCopy({ ...base, connection: 'connected', relaySynced: false }).shared).toMatch(
			/connected, syncing/i
		);
		// The case a naive template ("Shared with N others") would render as nonsense.
		expect(
			connectionCopy({ ...base, connection: 'connected', relaySynced: true, peerCount: 0 }).shared
		).not.toMatch(/0 others?/i);
		expect(
			connectionCopy({ ...base, connection: 'connected', relaySynced: true, peerCount: 0 }).shared
		).toMatch(/ready to share/i);
	});

	it('gets singular/plural right for the peer count', () => {
		expect(
			connectionCopy({ ...base, connection: 'connected', relaySynced: true, peerCount: 1 }).shared
		).toBe('Shared with 1 other');
		expect(
			connectionCopy({ ...base, connection: 'connected', relaySynced: true, peerCount: 4 }).shared
		).toBe('Shared with 4 others');
	});

	it('the two sentences vary independently — a blocked database says so regardless of sharing', () => {
		const copy = connectionCopy({
			persisted: false,
			connection: 'connected',
			relaySynced: true,
			peerCount: 2
		});
		expect(copy.stored).toMatch(/not saved/i);
		expect(copy.shared).toBe('Shared with 2 others');
	});
});
