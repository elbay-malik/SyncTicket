// The Phase 5 acceptance risk in one file: fractional keys must survive being generated
// concurrently on replicas that cannot see each other, and a drag must never throw.

import { describe, expect, it } from 'vitest';
import { generateKeyBetween } from 'fractional-indexing';
import { appendOrderKey, orderKeyBetween, planRepairs, type Ordered } from './order.js';

/** A key is valid iff fractional-indexing will accept it as a bound. */
function isValidKey(key: string): boolean {
	try {
		generateKeyBetween(key, null);
		return true;
	} catch {
		return false;
	}
}

const ordered = (...pairs: Array<[string, string]>): Ordered[] =>
	pairs.map(([id, order]) => ({ id, order }));

describe('appendOrderKey', () => {
	it('produces valid, strictly increasing keys', () => {
		let max: string | null = null;
		const keys: string[] = [];
		for (let i = 0; i < 50; i += 1) {
			max = appendOrderKey(max);
			expect(isValidKey(max)).toBe(true);
			keys.push(max);
		}
		expect(keys).toEqual([...keys].sort());
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('gives two offline replicas different first keys', () => {
		// Without jitter both would mint "a0" and a later drag between them would throw.
		const first = appendOrderKey(null);
		const second = appendOrderKey(null);
		expect(first).not.toBe(second);
		expect(() => generateKeyBetween(...([first, second].sort() as [string, string]))).not.toThrow();
	});
});

describe('orderKeyBetween', () => {
	it('lands strictly between its bounds', () => {
		const key = orderKeyBetween('a0', 'a1');
		expect(key > 'a0').toBe(true);
		expect(key < 'a1').toBe(true);
		expect(isValidKey(key)).toBe(true);
	});

	it('stays below `next` even when the midpoint is a prefix of it', () => {
		// generateKeyBetween('a0', 'a0V') returns 'a0G'; the guard matters whenever the
		// midpoint shares a prefix with the upper bound, where a suffix could overshoot.
		for (const [low, high] of [
			['a0', 'a0V'],
			['a0V', 'a0W'],
			['a0', 'a0G'],
			['Zz', 'a0']
		] as Array<[string, string]>) {
			const key = orderKeyBetween(low, high);
			expect(key > low).toBe(true);
			expect(key < high).toBe(true);
			expect(isValidKey(key)).toBe(true);
		}
	});

	it('handles open bounds on either side', () => {
		const first = orderKeyBetween(null, 'a1');
		expect(first < 'a1').toBe(true);
		const last = orderKeyBetween('a1', null);
		expect(last > 'a1').toBe(true);
		expect(isValidKey(first)).toBe(true);
		expect(isValidKey(last)).toBe(true);
	});

	it('survives repeated insertion at the same slot', () => {
		// Dragging into the same gap over and over grows keys; it must stay valid and ordered.
		let low = 'a0';
		const high = 'a1';
		for (let i = 0; i < 40; i += 1) {
			const key = orderKeyBetween(low, high);
			expect(key > low).toBe(true);
			expect(key < high).toBe(true);
			low = key;
		}
	});
});

describe('planRepairs', () => {
	it('returns nothing when keys are already strictly increasing', () => {
		expect(planRepairs(ordered(['a', 'a0'], ['b', 'a1'], ['c', 'a2']))).toEqual([]);
		expect(planRepairs([])).toEqual([]);
		expect(planRepairs(ordered(['only', 'a0']))).toEqual([]);
	});

	function assertRepaired(items: Ordered[]) {
		const repairs = planRepairs(items);
		const byId = new Map(repairs.map((r) => [r.id, r.order]));
		const resolved = items.map((item) => byId.get(item.id) ?? item.order);
		for (let i = 1; i < resolved.length; i += 1) {
			expect(resolved[i]! > resolved[i - 1]!).toBe(true);
		}
		for (const key of resolved) expect(isValidKey(key)).toBe(true);
		return { repairs, resolved };
	}

	it('fixes a duplicate pair by rekeying only the offender', () => {
		const { repairs } = assertRepaired(ordered(['a', 'a0'], ['b', 'a0'], ['c', 'a5']));
		expect(repairs.map((r) => r.id)).toEqual(['b']);
	});

	it('fixes duplicates at the head, in a run, and at the tail', () => {
		assertRepaired(ordered(['a', 'a0'], ['b', 'a0']));
		assertRepaired(ordered(['a', 'a0'], ['b', 'a0'], ['c', 'a0'], ['d', 'a0']));
		assertRepaired(ordered(['a', 'a0'], ['b', 'a0'], ['c', 'a0'], ['d', 'a9']));
		assertRepaired(ordered(['a', 'a5'], ['b', 'a5'], ['c', 'a5'], ['d', 'a5'], ['e', 'a6']));
	});

	it('fixes an inverted pair', () => {
		// Display order is the id tiebreak, so the list handed to us can be out of key order.
		assertRepaired(ordered(['a', 'a5'], ['b', 'a1'], ['c', 'a9']));
	});

	it('leaves the healthy prefix untouched', () => {
		const items = ordered(['a', 'a0'], ['b', 'a1'], ['c', 'a1'], ['d', 'a2']);
		const repairs = planRepairs(items);
		expect(repairs.map((r) => r.id)).toEqual(['c']);
	});

	it('makes a drag between former duplicates safe', () => {
		// The exact scenario in the roadmap's Phase 5 risk note.
		const items = ordered(['from-a', 'a0'], ['from-b', 'a0']);
		const { resolved } = assertRepaired(items);
		expect(() => orderKeyBetween(resolved[0]!, resolved[1]!)).not.toThrow();
	});
});

describe('planRepairs (randomised)', () => {
	it('never throws and always yields a strictly increasing, valid list', () => {
		// Deterministic LCG so a failure is reproducible from the seed.
		let seed = 12345;
		const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
		const pool = ['a0', 'a1', 'a2', 'a5', 'a0V', 'Zz', 'b00', 'a0G'];
		for (let trial = 0; trial < 3000; trial += 1) {
			const n = 1 + Math.floor(rnd() * 12);
			const items: Ordered[] = [];
			for (let i = 0; i < n; i += 1) {
				items.push({ id: `i${i}`, order: pool[Math.floor(rnd() * pool.length)]! });
			}
			// Sort the way the app displays them: by key, then id.
			items.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : 1));
			const repairs = planRepairs(items);
			const byId = new Map(repairs.map((r) => [r.id, r.order]));
			const resolved = items.map((i) => byId.get(i.id) ?? i.order);
			for (const key of resolved) expect(isValidKey(key)).toBe(true);
			for (let i = 1; i < resolved.length; i += 1) {
				expect(resolved[i]! > resolved[i - 1]!).toBe(true);
			}
			// And a drop between any adjacent healed pair must not throw.
			for (let i = 1; i < resolved.length; i += 1) {
				expect(() => orderKeyBetween(resolved[i - 1]!, resolved[i]!)).not.toThrow();
			}
			expect(() => orderKeyBetween(resolved[resolved.length - 1] ?? null, null)).not.toThrow();
			expect(() => appendOrderKey(resolved[resolved.length - 1] ?? null)).not.toThrow();
		}
	});
});

describe('regressions found in review', () => {
	it('actually applies jitter when the midpoint is a prefix of `next`', () => {
		// The common board drop is "above the top card", whose key already carries a suffix.
		// generateKeyBetween returns a bare prefix there, so a naive guard would surrender the
		// jitter on almost every drop and hand both replicas the same deterministic key.
		const head = appendOrderKey(null);
		let jittered = 0;
		for (let i = 0; i < 200; i += 1) {
			const key = orderKeyBetween(null, head);
			expect(key < head).toBe(true);
			if (key !== generateKeyBetween(null, head)) jittered += 1;
		}
		expect(jittered).toBe(200);
	});

	it('produces distinct keys for the same drop on two replicas', () => {
		const head = appendOrderKey(null);
		const keys = new Set(Array.from({ length: 200 }, () => orderKeyBetween(null, head)));
		expect(keys.size).toBeGreaterThan(190);
	});

	it('falls back to an unjittered key rather than overshooting', () => {
		// A suffix source that always overshoots must still yield a key inside the bounds.
		const key = orderKeyBetween('a0', 'a1', () => 'zzzz');
		expect(key > 'a0').toBe(true);
		expect(key < 'a1').toBe(true);
	});

	it('treats a blank order key as damage rather than a bound', () => {
		// readIssue defaults a missing `order` to ''; passing that to fractional-indexing
		// throws a TypeError, so planRepairs has to rewrite it.
		for (const items of [
			ordered(['a', ''], ['b', 'a0']),
			ordered(['a', ''], ['b', '']),
			ordered(['a', 'a0'], ['b', ''], ['c', 'a1'])
		]) {
			const repairs = planRepairs(items);
			const byId = new Map(repairs.map((r) => [r.id, r.order]));
			const resolved = items.map((item) => byId.get(item.id) ?? item.order);
			for (const key of resolved) expect(isValidKey(key)).toBe(true);
			for (let i = 1; i < resolved.length; i += 1) {
				expect(resolved[i]! > resolved[i - 1]!).toBe(true);
			}
		}
	});

	it('never hands a blank bound to fractional-indexing', () => {
		expect(() => orderKeyBetween('', null)).not.toThrow();
		expect(() => orderKeyBetween(null, '')).not.toThrow();
		expect(() => appendOrderKey('')).not.toThrow();
	});
});
