import { describe, expect, it } from 'vitest';
import { parsePersistenceNotice } from './relay-notice.js';

// The pinned wire contract, written out as a literal rather than built from the encoder.
// The same literal appears in workers/relay/src/storage.test.ts, asserted against
// `encodePersistenceNotice`'s output — which is the whole point: the two halves of this
// channel live in separate packages and cannot share a type, so a key renamed or reordered
// on one side fails the other side's suite instead of silently going unreported.
const PINNED =
	'{"v":1,"type":"persistence","state":"degraded","reason":"too-big","at":1700000000000}';

describe('parsePersistenceNotice', () => {
	it('round-trips the pinned frame the relay encodes', () => {
		expect(parsePersistenceNotice(PINNED)).toEqual({
			state: 'degraded',
			reason: 'too-big',
			at: 1700000000000
		});
	});

	it('accepts an ok notice, which carries no reason', () => {
		expect(parsePersistenceNotice('{"v":1,"type":"persistence","state":"ok","at":5}')).toEqual({
			state: 'ok',
			at: 5
		});
	});

	it('accepts stale, the eviction-after-a-failed-save case', () => {
		expect(
			parsePersistenceNotice(
				'{"v":1,"type":"persistence","state":"stale","reason":"too-big","at":7}'
			)
		).toEqual({ state: 'stale', reason: 'too-big', at: 7 });
	});

	// Anything the relay could not have sent is ignored, not guessed at. The UI keys its copy
	// off `state` and `reason`, so accepting a half-understood frame would put a sentence on
	// screen that nothing on the relay vouches for.
	const rejected: Array<[string, string]> = [
		['not JSON at all', 'persistence degraded'],
		['an empty string', ''],
		['a JSON array', '[{"v":1,"type":"persistence","state":"degraded","at":1}]'],
		['a JSON scalar', '42'],
		['a JSON string', '"degraded"'],
		['null', 'null'],
		['a future version', '{"v":2,"type":"persistence","state":"degraded","at":1}'],
		['an unknown type', '{"v":1,"type":"presence","state":"degraded","at":1}'],
		['an unknown state', '{"v":1,"type":"persistence","state":"on-fire","at":1}'],
		['a non-string state', '{"v":1,"type":"persistence","state":3,"at":1}'],
		['a missing at', '{"v":1,"type":"persistence","state":"degraded"}'],
		['a non-numeric at', '{"v":1,"type":"persistence","state":"degraded","at":"now"}'],
		// `1e999` is the one way JSON reaches Infinity, and an infinite `at` would outrank
		// every acknowledgement and pin the notice open for the rest of the session.
		['a non-finite at', '{"v":1,"type":"persistence","state":"degraded","at":1e999}']
	];

	for (const [name, raw] of rejected) {
		it(`returns null for ${name}`, () => {
			expect(parsePersistenceNotice(raw)).toBeNull();
		});
	}

	it('drops an unrecognised reason but keeps the state', () => {
		expect(
			parsePersistenceNotice(
				'{"v":1,"type":"persistence","state":"degraded","reason":"moon","at":9}'
			)
		).toEqual({ state: 'degraded', at: 9 });
	});

	it('never throws, whatever arrives on the socket', () => {
		const hostile = [
			...rejected.map(([, raw]) => raw),
			PINNED,
			// A megabyte of junk: the frame is attacker-reachable, so the parser's failure mode
			// has to be a return value rather than an exception at any size.
			'x'.repeat(1_000_000),
			`{"v":1,"type":"persistence","state":"degraded","reason":"${'z'.repeat(1_000_000)}","at":1}`
		];
		for (const raw of hostile) {
			expect(() => parsePersistenceNotice(raw)).not.toThrow();
		}
	});

	it('returns null for a 1 MB string', () => {
		expect(parsePersistenceNotice('x'.repeat(1_000_000))).toBeNull();
	});
});
