import { describe, expect, it } from 'vitest';
import { REARM_SLACK_MS, ROOM_TTL_MS, nextExpiry, onExpiry } from './expiry.js';

describe('nextExpiry', () => {
	const now = 1_000_000_000;

	it('sets an alarm on a room that has none, a full term away', () => {
		expect(nextExpiry(now, null)).toBe(now + ROOM_TTL_MS);
	});

	it('leaves a recent alarm alone, so saves while someone types cost no storage writes', () => {
		expect(nextExpiry(now, now + ROOM_TTL_MS)).toBeNull();
		expect(nextExpiry(now, now + ROOM_TTL_MS - REARM_SLACK_MS + 1)).toBeNull();
	});

	it('moves an alarm that has fallen behind by more than the slack', () => {
		expect(nextExpiry(now, now + ROOM_TTL_MS - REARM_SLACK_MS - 1)).toBe(now + ROOM_TTL_MS);
		expect(nextExpiry(now, now - 5)).toBe(now + ROOM_TTL_MS);
	});
});

describe('onExpiry', () => {
	it('expires a room nobody is in', () => {
		expect(onExpiry(0, 5)).toEqual({ action: 'expire' });
	});

	it('puts it off for a full term while anyone is connected', () => {
		expect(onExpiry(2, 5)).toEqual({ action: 'postpone', until: 5 + ROOM_TTL_MS });
	});
});
