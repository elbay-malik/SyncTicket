import { describe, expect, it } from 'vitest';
import { RRF_K, cosineSimilarity, fuseRanks, topBySimilarity } from './rank.js';

describe('fuseRanks', () => {
	it('returns a single list unchanged', () => {
		expect(fuseRanks([['a', 'b', 'c']])).toEqual(['a', 'b', 'c']);
	});

	it('rewards agreement between the two rankers', () => {
		// "b" is second in both; "a" and "c" are each first in one and absent from the other.
		const fused = fuseRanks([
			['a', 'b'],
			['c', 'b']
		]);
		expect(fused[0]).toBe('b');
		expect(fused.slice(1).sort()).toEqual(['a', 'c']);
	});

	it('lets a strong single-ranker result beat a mediocre consensus', () => {
		const top = ['first'];
		const alsoRan = Array.from({ length: 100 }, (_, i) => `x${i}`);
		const fused = fuseRanks([top, ['x50', 'x51']]);
		expect(fused[0]).toBe('first');
		expect(alsoRan).toContain(fused[1]);
	});

	it('keeps every id from every list, without duplicates', () => {
		const fused = fuseRanks([
			['a', 'b'],
			['b', 'c'],
			['c', 'd']
		]);
		expect(fused.sort()).toEqual(['a', 'b', 'c', 'd']);
	});

	it('breaks ties by first appearance, so the result is deterministic', () => {
		// Identical lists give every id an identical score; order must still be stable.
		const fused = fuseRanks([
			['a', 'b', 'c'],
			['a', 'b', 'c']
		]);
		expect(fused).toEqual(['a', 'b', 'c']);
	});

	it('handles empty input', () => {
		expect(fuseRanks([])).toEqual([]);
		expect(fuseRanks([[], []])).toEqual([]);
		expect(fuseRanks([[], ['a']])).toEqual(['a']);
	});

	it('uses a damping constant that keeps deep ranks meaningful', () => {
		// With k=60, rank 1 scores 1/61 and rank 2 scores 1/62 — close together, which is the
		// point: RRF should not treat a near-miss as worthless.
		const [first, second] = [1 / (RRF_K + 1), 1 / (RRF_K + 2)];
		expect(second / first).toBeGreaterThan(0.98);
	});
});

describe('cosineSimilarity', () => {
	const v = (...values: number[]) => Float32Array.from(values);

	it('is 1 for identical direction and 0 for orthogonal', () => {
		expect(cosineSimilarity(v(1, 0), v(1, 0))).toBeCloseTo(1);
		expect(cosineSimilarity(v(1, 0), v(2, 0))).toBeCloseTo(1);
		expect(cosineSimilarity(v(1, 0), v(0, 1))).toBeCloseTo(0);
		expect(cosineSimilarity(v(1, 0), v(-1, 0))).toBeCloseTo(-1);
	});

	it('refuses mismatched or empty vectors instead of guessing', () => {
		expect(cosineSimilarity(v(1, 0), v(1, 0, 0))).toBe(0);
		expect(cosineSimilarity(v(), v())).toBe(0);
		expect(cosineSimilarity(v(0, 0), v(1, 1))).toBe(0);
	});
});

describe('topBySimilarity', () => {
	const scored = [
		{ id: 'low', score: 0.1 },
		{ id: 'high', score: 0.9 },
		{ id: 'mid', score: 0.5 }
	];

	it('returns the best ids, highest first', () => {
		expect(topBySimilarity(scored, 2)).toEqual(['high', 'mid']);
		expect(topBySimilarity(scored, 10)).toEqual(['high', 'mid', 'low']);
	});

	it('handles degenerate limits', () => {
		expect(topBySimilarity(scored, 0)).toEqual([]);
		expect(topBySimilarity([], 5)).toEqual([]);
	});

	it('matches a full sort over a large candidate set', () => {
		// The bounded insert is an optimisation; it must not change the answer.
		let seed = 7;
		const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000;
		const many = Array.from({ length: 5000 }, (_, i) => ({ id: `i${i}`, score: random() }));
		const expected = [...many]
			.sort((a, b) => b.score - a.score)
			.slice(0, 20)
			.map((c) => c.id);
		expect(topBySimilarity(many, 20)).toEqual(expected);
	});
});
