import { describe, expect, it } from 'vitest';
import { mapSelection } from './keep-selection.js';

const caret = (at: number) => ({ start: at, end: at });

describe('mapSelection', () => {
	it('keeps everything selected when everything was', () => {
		expect(mapSelection('Original', "Alice's edit", { start: 0, end: 8 })).toEqual({
			start: 0,
			end: 12
		});
	});

	it('keeps a caret at the end at the end, however the text changed', () => {
		expect(mapSelection('Alice', 'Bob, later on', caret(5))).toEqual(caret(13));
		expect(mapSelection('Fix', 'Fix the login bug', caret(3))).toEqual(caret(17));
		expect(mapSelection('Fix login', '[P1] Fix login', caret(9))).toEqual(caret(14));
		expect(mapSelection('Long original', 'Short', caret(13))).toEqual(caret(5));
	});

	it('treats an empty field as a caret at the end', () => {
		expect(mapSelection('', 'Steps to reproduce', caret(0))).toEqual(caret(18));
	});

	it('keeps a caret after text that did not change where it was', () => {
		expect(mapSelection('Fix login page', 'Fix login form', caret(3))).toEqual(caret(3));
	});

	it('shifts a caret by what was added or removed before it', () => {
		expect(mapSelection('Fix login', '[P1] Fix login', caret(4))).toEqual(caret(9));
		expect(mapSelection('[P1] Fix login', 'Fix login', caret(9))).toEqual(caret(4));
	});

	it('moves an end inside the changed span to the end of the new span', () => {
		// "login" became "signup"; a caret in the middle of the old word ends after the new one.
		expect(mapSelection('Fix login page', 'Fix signup page', caret(6))).toEqual(caret(10));
	});

	it('maps both ends of a partial selection', () => {
		// Selecting "login" while a prefix is added keeps "login" selected.
		expect(mapSelection('Fix login', '[P1] Fix login', { start: 4, end: 9 })).toEqual({
			start: 9,
			end: 14
		});
	});

	it('never points past the new text', () => {
		for (const [before, after] of [
			['aaaa', 'a'],
			['abcabc', 'abc'],
			['', ''],
			['same', 'same']
		] as const) {
			for (let start = 0; start <= before.length; start += 1) {
				for (let end = start; end <= before.length; end += 1) {
					const mapped = mapSelection(before, after, { start, end });
					expect(mapped.start).toBeGreaterThanOrEqual(0);
					expect(mapped.end).toBeLessThanOrEqual(after.length);
					expect(mapped.start).toBeLessThanOrEqual(mapped.end);
				}
			}
		}
	});
});
