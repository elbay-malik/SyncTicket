import { describe, expect, it } from 'vitest';
import { planLoad, planSave, planWriteError } from './persistence-plan.js';
import type { PersistenceState, SnapshotSize } from './storage.js';

const ROOM = 'a1b2c3d4';
const NOW = 1700000000000;

function save(
	over: Partial<{
		bytes: number;
		size: SnapshotSize;
		state: PersistenceState;
		warned: boolean;
		structs: number;
		wakeWarned: boolean;
	}> = {}
) {
	return planSave({
		bytes: 1_000_000,
		size: 'ok',
		state: 'ok',
		warned: false,
		// Well under WAKE_WARN_STRUCTS, so the wake axis stays out of every test that is not
		// about it. Spelled out rather than left to default, because an omitted `structs`
		// would compare `undefined > 20_000` as false and silently mean "never warn" — the
		// typecheck is the only thing that catches that, so it must stay required.
		structs: 1_000,
		wakeWarned: false,
		room: ROOM,
		now: NOW,
		...over
	});
}

describe('planSave — over the ceiling', () => {
	it('refuses the write and announces the transition once', () => {
		expect(save({ bytes: 2_041_188, size: 'over' })).toEqual({
			write: false,
			next: 'degraded',
			reason: 'too-big',
			notice:
				'{"v":1,"type":"persistence","state":"degraded","reason":"too-big","at":1700000000000}',
			log: 'relay.persistence event=degraded room=a1b2c3d4 bytes=2041188 reason=too-big',
			recordHealth: true
		});
	});

	it('is completely silent while already degraded', () => {
		// The saves that overflow a room repeat every few seconds. Re-announcing each one
		// would be 43,200 log lines and row writes a day for one stuck room.
		const plan = save({ bytes: 2_041_188, size: 'over', state: 'degraded' });
		expect(plan).toEqual({
			write: false,
			next: 'degraded',
			reason: 'too-big',
			notice: null,
			log: null,
			recordHealth: false
		});
		expect(plan.notice).toBeNull();
		expect(plan.log).toBeNull();
		expect(plan.recordHealth).toBe(false);
		expect(plan.write).toBe(false);
	});

	it('is equally silent while already stale, and does not weaken the latch', () => {
		// The regression that matters most in this file. `planLoad` re-derives a stored failure
		// as 'stale', and `hibernate: true` runs `onLoad` on every wake — so a guard that only
		// recognised 'degraded' treated 'stale' as a fresh transition on the next edit after
		// every single wake. A room edited every 30 s wakes ~2,880 times a day: ~2,880 health
		// row writes and ~5,760 log lines against the budget this exists to defend, 'stale'
		// never latching, and the banner the user dismissed returning on every cycle.
		const plan = save({ bytes: 2_041_188, size: 'over', state: 'stale' });
		expect(plan).toEqual({
			write: false,
			next: 'stale',
			reason: 'too-big',
			notice: null,
			log: null,
			recordHealth: false
		});
	});

	it('announces again once it has recovered in between', () => {
		expect(save({ size: 'over', state: 'ok' }).notice).not.toBeNull();
	});
});

describe('planSave — under the ceiling', () => {
	it('writes silently when nothing has changed', () => {
		expect(save()).toEqual({
			write: true,
			next: 'ok',
			notice: null,
			log: null,
			recordHealth: false
		});
	});

	for (const state of ['degraded', 'stale'] as const) {
		it(`reports recovery from '${state}' and rewrites the health row`, () => {
			expect(save({ bytes: 1_402_331, state })).toEqual({
				write: true,
				next: 'ok',
				notice: '{"v":1,"type":"persistence","state":"ok","at":1700000000000}',
				log: 'relay.persistence event=recovered room=a1b2c3d4 bytes=1402331',
				recordHealth: true
			});
		});
	}

	it('recovers from a warn-sized snapshot too — only "over" blocks the write', () => {
		expect(save({ size: 'warn', state: 'degraded' }).next).toBe('ok');
	});
});

describe('planSave — the wake-cost axis', () => {
	// Independent of bytes in BOTH directions, which is the reason it exists. A document can
	// be expensive to wake while far under the byte warn, and cheap to wake while over the
	// byte ceiling, so neither guard implies the other.
	it('logs once when a cheap-looking document is expensive to wake', () => {
		// 880 KB of snapshot — the byte guard is silent — but 30,000 structs is ~18 ms.
		const plan = save({ bytes: 881_591, size: 'ok', structs: 30_000 });
		expect(plan.write).toBe(true);
		expect(plan.log).toBe(
			'relay.persistence event=wake-cost room=a1b2c3d4 structs=30000 approx_ms=18'
		);
		expect(plan.wakeWarned).toBe(true);
		// Still not a user-facing fact: nobody is told, and nothing is recorded.
		expect(plan.notice).toBeNull();
		expect(plan.recordHealth).toBe(false);
	});

	it('says nothing once the line has been logged', () => {
		expect(save({ size: 'ok', structs: 30_000, wakeWarned: true }).log).toBeNull();
	});

	it('says nothing about a large but cheap document', () => {
		// 1.96 MB over the ceiling, yet only 13,150 structs — about 8 ms to wake.
		const plan = save({ bytes: 1_958_321, size: 'over', structs: 13_150 });
		expect(plan.log).toBe(
			'relay.persistence event=degraded room=a1b2c3d4 bytes=1958321 reason=too-big'
		);
		expect(plan.wakeWarned).toBeUndefined();
	});

	it('reports both axes when a save crosses them together', () => {
		// They are unrelated conditions, so one must not swallow the other.
		const plan = save({ bytes: 1_600_000, size: 'warn', structs: 30_000 });
		expect(plan.log?.split('\n')).toEqual([
			'relay.persistence event=warn room=a1b2c3d4 bytes=1600000',
			'relay.persistence event=wake-cost room=a1b2c3d4 structs=30000 approx_ms=18'
		]);
	});

	it('still reports the wake cost while the room is already degraded and silent', () => {
		// The degraded steady state is otherwise total silence. A wake-cost crossing is new
		// information on a different axis, and losing it there would hide the one failure that
		// has no graceful degradation.
		const plan = save({ bytes: 2_041_188, size: 'over', state: 'degraded', structs: 30_000 });
		expect(plan.notice).toBeNull();
		expect(plan.recordHealth).toBe(false);
		expect(plan.log).toBe(
			'relay.persistence event=wake-cost room=a1b2c3d4 structs=30000 approx_ms=18'
		);
	});
});

describe('planSave — the warn crossing', () => {
	it('logs once and tells nobody: 75% is not a user-facing fact', () => {
		expect(save({ bytes: 1_612_004, size: 'warn' })).toEqual({
			write: true,
			next: 'ok',
			notice: null,
			log: 'relay.persistence event=warn room=a1b2c3d4 bytes=1612004',
			recordHealth: false
		});
	});

	it('does not repeat while the caller holds the latch', () => {
		expect(save({ size: 'warn', warned: true }).log).toBeNull();
	});

	it('re-arms only after the size is back to ok', () => {
		// The caller clears `warned` when the size is 'ok'; this is the plan it then gets.
		expect(save({ size: 'ok', warned: true }).log).toBeNull();
		expect(save({ bytes: 1_612_004, size: 'warn', warned: false }).log).toContain('event=warn');
	});
});

describe('planWriteError', () => {
	const fail = (err: unknown, state: PersistenceState = 'ok') =>
		planWriteError({ err, bytes: 1_998_412, state, room: ROOM, now: NOW });

	it('recognises the only discriminator workerd actually provides', () => {
		expect(fail(new Error('string or blob too big: SQLITE_TOOBIG')).reason).toBe('too-big');
	});

	for (const err of [
		new Error('database or disk is full: SQLITE_FULL'),
		new Error('anything else'),
		'a bare string',
		undefined,
		{}
	]) {
		it(`reports 'unknown' for ${JSON.stringify(err instanceof Error ? err.message : err)}`, () => {
			const plan = fail(err);
			expect(plan.reason).toBe('unknown');
			expect(plan.next).toBe('degraded');
		});
	}

	it('survives an error object whose message getter throws', () => {
		// This case is the whole reason `classifyWriteError` is written defensively: a throw
		// inside onSave's catch escapes into y-partyserver's swallow, which is the original
		// bug reintroduced by its own fix.
		const hostile = {
			get message(): string {
				throw new Error('nope');
			}
		};
		const plan = fail(hostile);
		expect(plan.reason).toBe('unknown');
		expect(plan.next).toBe('degraded');
		expect(plan.notice).toBe(
			'{"v":1,"type":"persistence","state":"degraded","reason":"unknown","at":1700000000000}'
		);
	});

	it('announces the first failure and records it', () => {
		expect(fail(new Error('string or blob too big: SQLITE_TOOBIG'))).toEqual({
			write: false,
			next: 'degraded',
			reason: 'too-big',
			notice:
				'{"v":1,"type":"persistence","state":"degraded","reason":"too-big","at":1700000000000}',
			log: 'relay.persistence event=degraded room=a1b2c3d4 bytes=1998412 reason=too-big',
			recordHealth: true
		});
	});

	it('is silent on a repeat failure while already degraded', () => {
		expect(fail(new Error('string or blob too big'), 'degraded')).toEqual({
			write: false,
			next: 'degraded',
			reason: 'too-big',
			notice: null,
			log: null,
			recordHealth: false
		});
	});
});

describe('planLoad', () => {
	const load = (healthRow: unknown) =>
		planLoad({ healthRow, bytes: 1_998_412, room: ROOM, now: NOW });

	for (const state of ['degraded', 'stale'] as const) {
		it(`comes back 'stale' from a '${state}' row, dated when the failure happened`, () => {
			const at = Date.UTC(2026, 0, 2, 3, 4, 5);
			// `at` in the notice is the STORED timestamp, not this call's clock. The client
			// compares it against what the viewer dismissed, and `onLoad` runs on every
			// hibernation wake — so minting a fresh one here would un-dismiss the banner over
			// and over for a condition that has not changed.
			expect(load({ state, bytes: 2_041_188, at, reason: 'too-big' })).toEqual({
				state: 'stale',
				reason: 'too-big',
				notice: `{"v":1,"type":"persistence","state":"stale","reason":"too-big","at":${at}}`,
				log: `relay.persistence event=stale-load room=a1b2c3d4 bytes=1998412 since=2026-01-02T03:04:05.000Z`
			});
		});
	}

	it('reports an unrecognised stored reason as unknown rather than guessing', () => {
		expect(load({ state: 'degraded', at: NOW, reason: 'something-new' }).reason).toBe('unknown');
	});

	it('starts quietly on anything it cannot read', () => {
		// Same posture as decodeSnapshot: a health marker we cannot parse is not evidence of
		// loss, and a room that refuses to start is worse than one that starts.
		for (const row of [
			undefined,
			null,
			{},
			{ state: 'ok', bytes: 10, at: NOW, reason: null },
			{ state: 'nonsense' },
			{ state: 42 },
			'degraded',
			[],
			0
		]) {
			expect(load(row)).toEqual({ state: 'ok', notice: null, log: null });
		}
	});

	it('carries the stored timestamp into the notice rather than minting a new one', () => {
		// `at` identifies the failure and the client compares it against what the viewer has
		// dismissed, so a fresh `at` on every hibernation wake would un-dismiss the banner for
		// a condition that has not changed.
		const first = 1699000000000;
		expect(load({ state: 'degraded', reason: 'too-big', at: first })?.notice).toBe(
			`{"v":1,"type":"persistence","state":"stale","reason":"too-big","at":${first}}`
		);
	});

	it('falls back to its own clock when the stored timestamp is unusable', () => {
		for (const at of [Number.NaN, Number.POSITIVE_INFINITY, 1e300, 'yesterday', null]) {
			expect(load({ state: 'degraded', at })?.log).toContain('since=2023-11-14T22:13:20.000Z');
		}
	});
});
