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

	it('rejects what a Date cannot hold, rather than throwing while a view renders', () => {
		expect(isoTime(8.64e15)).toBe('+275760-09-13T00:00:00.000Z');
		for (const timestamp of [8.64e15 + 1, 1e300, Infinity]) {
			expect(isoTime(timestamp)).toBeUndefined();
		}
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
	const base = {
		persisted: true,
		relaySynced: false,
		peerCount: 0,
		relayPersistence: 'ok'
	} as const;

	it('never claims durability a blocked database does not have', () => {
		expect(connectionCopy({ ...base, connection: 'local' }).stored).toBe('Saved on this device');
		expect(connectionCopy({ ...base, persisted: false, connection: 'local' }).stored).toMatch(
			/not saved/i
		);
	});

	it('is exhaustive over every connection state, including connected+synced+alone', () => {
		// The exact literal, not a pattern: docs/DEMO.md quotes this sentence and claims it is
		// pinned by a test. The demo script runs with a relay configured, so `e2e/demo.e2e.ts`
		// can never reach this state — this assertion is the only thing holding that quote.
		expect(connectionCopy({ ...base, connection: 'local' }).shared).toBe(
			'Local only — no relay configured'
		);
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
			peerCount: 2,
			relayPersistence: 'ok'
		});
		expect(copy.stored).toMatch(/not saved/i);
		expect(copy.shared).toBe('Shared with 2 others');
	});
});

describe('connectionCopy durability sentence', () => {
	// Connected and synced throughout: the point of this sentence is that relay storage can
	// fail while the connection and the local database are both perfectly healthy, so the
	// other two sentences would say nothing is wrong.
	const base = {
		persisted: true,
		connection: 'connected',
		relaySynced: true,
		peerCount: 1
	} as const;

	// Asserted explicitly, not just left untested: a healthy workspace must not grow a
	// reassurance row in the popover. If `durable` ever returned a string here, every visitor
	// would see a line about relay storage on every visit and stop reading the popover at all
	// — which is exactly the attention this notice needs when something is actually wrong.
	it('says nothing at all when the relay is storing normally', () => {
		expect(connectionCopy({ ...base, relayPersistence: 'ok' }).durable).toBeNull();
		expect(
			connectionCopy({ ...base, persisted: false, relayPersistence: 'ok' }).durable
		).toBeNull();
		// A reason cannot arrive with 'ok', but a frame is only as well-behaved as its sender.
		expect(
			connectionCopy({ ...base, relayPersistence: 'ok', relayPersistenceReason: 'too-big' }).durable
		).toBeNull();
	});

	it('names the ceiling as full, and terminal, when that is what happened', () => {
		expect(
			connectionCopy({ ...base, relayPersistence: 'degraded', relayPersistenceReason: 'too-big' })
				.durable
		).toBe(
			"The relay has stopped saving this workspace — it's full. Your work is still saved in this browser, but other people's copies may fall behind."
		);
	});

	it('promises a retry only for the failure that actually retries', () => {
		expect(
			connectionCopy({ ...base, relayPersistence: 'degraded', relayPersistenceReason: 'unknown' })
				.durable
		).toBe(
			"The relay's last save failed, so it isn't storing this workspace right now. Your work is still saved in this browser. Retrying automatically."
		);
	});

	it('drops to the blunter sentence when this browser cannot save either — whatever the reason', () => {
		const blunt =
			"The relay has stopped saving this workspace, and this browser can't save locally either. Nothing here will survive closing the tab.";
		expect(
			connectionCopy({
				...base,
				persisted: false,
				relayPersistence: 'degraded',
				relayPersistenceReason: 'too-big'
			}).durable
		).toBe(blunt);
		expect(
			connectionCopy({
				...base,
				persisted: false,
				relayPersistence: 'degraded',
				relayPersistenceReason: 'unknown'
			}).durable
		).toBe(blunt);
		// No reason at all is still this case: the local half is the part that matters here.
		expect(
			connectionCopy({ ...base, persisted: false, relayPersistence: 'degraded' }).durable
		).toBe(blunt);
	});

	it('reports a stale copy as a loss that has already happened', () => {
		const stale =
			"Part of this workspace's history was lost: the relay ran out of room before it could save. What you see is the last copy it managed to keep.";
		expect(connectionCopy({ ...base, relayPersistence: 'stale' }).durable).toBe(stale);
		expect(
			connectionCopy({ ...base, relayPersistence: 'stale', relayPersistenceReason: 'too-big' })
				.durable
		).toBe(stale);
	});

	it('leaves the other two sentences alone', () => {
		const copy = connectionCopy({
			...base,
			relayPersistence: 'degraded',
			relayPersistenceReason: 'too-big'
		});
		expect(copy.stored).toBe('Saved on this device');
		expect(copy.shared).toBe('Shared with 1 other');
	});
});

describe('connectionCopy().short', () => {
	// The header label is the first and often only connection fact a visitor reads, so the
	// thing worth testing is not its wording but that it cannot say something the long
	// sentence beneath it contradicts.
	const base = {
		persisted: true,
		connection: 'connected' as const,
		relaySynced: true,
		peerCount: 0,
		relayPersistence: 'ok' as const
	};

	it('never claims local storage the browser does not have', () => {
		expect(connectionCopy({ ...base, persisted: false }).short.stored).toBe('Not saved');
		expect(connectionCopy(base).short.stored).toBe('Saved locally');
	});

	it('distinguishes a missing relay from an unreachable one', () => {
		// 'Local only' and 'Offline' are different facts: no relay configured at all versus a
		// relay this browser cannot currently reach. Collapsing them was the original sin the
		// long copy already avoids.
		expect(connectionCopy({ ...base, connection: 'local' }).short.shared).toBe('Local only');
		expect(connectionCopy({ ...base, connection: 'offline' }).short.shared).toBe('Offline');
	});

	it('does not say "ready to share" before the relay has spoken', () => {
		expect(connectionCopy({ ...base, relaySynced: false }).short.shared).toBe('Syncing…');
		expect(connectionCopy(base).short.shared).toBe('Ready to share');
	});

	it('counts peers', () => {
		expect(connectionCopy({ ...base, peerCount: 1 }).short.shared).toBe('Shared with 1');
		expect(connectionCopy({ ...base, peerCount: 4 }).short.shared).toBe('Shared with 4');
	});

	it('adds no durability badge when nothing is wrong', () => {
		// The header must not reassure. Same rule as the popover's third sentence.
		expect(connectionCopy(base).short.durable).toBeNull();
		expect(connectionCopy({ ...base, relayPersistence: 'degraded' }).short.durable).toBe(
			'Not saving'
		);
		expect(connectionCopy({ ...base, relayPersistence: 'stale' }).short.durable).toBe(
			'History lost'
		);
	});

	it('stays short enough for a header at every state', () => {
		// A label that wraps the header is a layout bug that only shows up in one state, which
		// is exactly the kind nobody catches. 18 characters is the longest shipped here.
		for (const connection of ['local', 'offline', 'connecting', 'connected'] as const) {
			for (const persisted of [true, false]) {
				for (const peerCount of [0, 1, 12]) {
					const { short } = connectionCopy({ ...base, connection, persisted, peerCount });
					expect(short.stored.length).toBeLessThanOrEqual(18);
					expect(short.shared.length).toBeLessThanOrEqual(18);
				}
			}
		}
	});
});
