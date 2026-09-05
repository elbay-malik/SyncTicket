import { describe, expect, it } from 'vitest';
import { isoTime, relativeTime } from './format.js';

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
