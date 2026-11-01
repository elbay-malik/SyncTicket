// The suite only runs where a stack overflow is a RangeError, so the library's recursion is stood
// in for here with what each engine really throws. bad-order-keys.test.ts overflows the stack for
// real, in V8. Firefox reports it as `InternalError: too much recursion`, which is no RangeError.

import { describe, expect, it, vi } from 'vitest';
import {
	appendOrderKey,
	isOrderKey,
	orderKeyBetween,
	orderKeysBetween,
	planRepairs
} from './order.js';

const thrown = vi.hoisted(() => ({ overflow: null as (() => Error) | null }));

vi.mock('fractional-indexing', async (importOriginal) => {
	const library = await importOriginal<typeof import('fractional-indexing')>();
	return {
		...library,
		generateKeyBetween: (lower: string | null, upper: string | null) => {
			if (thrown.overflow && lower?.includes('zzzz')) throw thrown.overflow();
			return library.generateKeyBetween(lower, upper);
		}
	};
});

/** The shape of what SpiderMonkey throws: not a RangeError, and only `name` says what it is. */
class InternalError extends Error {
	override name = 'InternalError';
}

const LARGEST_RUN = 'z'.repeat(27) + 'z'.repeat(20_000);
const MIDDLE_RUN = `a0${'z'.repeat(20_000)}`;

describe.each([
	{ engine: 'Firefox', overflow: () => new InternalError('too much recursion') },
	{
		engine: 'Chromium and Safari',
		overflow: () => new RangeError('Maximum call stack size exceeded')
	}
])('when the stack runs out in $engine', ({ overflow }) => {
	const during = <T>(run: () => T): T => {
		thrown.overflow = overflow;
		try {
			return run();
		} finally {
			thrown.overflow = null;
		}
	};

	it('still appends after the largest key', () => {
		const key = during(() => appendOrderKey(LARGEST_RUN));
		expect(isOrderKey(key)).toBe(true);
		expect(key > LARGEST_RUN).toBe(true);
	});

	it('still mints between a long run and the key after it', () => {
		const key = during(() => orderKeyBetween(MIDDLE_RUN, 'a1'));
		expect(isOrderKey(key)).toBe(true);
		expect(key > MIDDLE_RUN).toBe(true);
		expect(key < 'a1').toBe(true);
	});

	it('still repairs a column with a long run in it', () => {
		const repairs = during(() =>
			planRepairs([
				{ id: 'run', order: MIDDLE_RUN },
				{ id: 'blank', order: '' },
				{ id: 'next', order: 'a1' }
			])
		);
		const order = repairs[0]?.order ?? '';
		expect(repairs.map((repair) => repair.id)).toEqual(['blank']);
		expect(order > MIDDLE_RUN && order < 'a1').toBe(true);
	});

	it('still seeds after the largest key', () => {
		const keys = during(() => orderKeysBetween(LARGEST_RUN, null, 3));
		expect(keys).toHaveLength(3);
		expect(keys.every(isOrderKey)).toBe(true);
		expect(keys[0]! > LARGEST_RUN && keys[0]! < keys[1]! && keys[1]! < keys[2]!).toBe(true);
	});
});

describe('what is not a stack overflow', () => {
	it('still surfaces the library refusing equal bounds', () => {
		expect(() => orderKeyBetween('a1', 'a1')).toThrow('>=');
	});

	it('is not swallowed when it is some other error', () => {
		thrown.overflow = () => new TypeError('a bug');
		try {
			expect(() => appendOrderKey(LARGEST_RUN)).toThrow('a bug');
		} finally {
			thrown.overflow = null;
		}
	});
});
