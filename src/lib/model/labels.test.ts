import { describe, expect, it } from 'vitest';
import { formatLabels, labelsEqual, parseLabels } from './labels.js';

describe('parseLabels', () => {
	it('splits on commas and trims whitespace', () => {
		expect(parseLabels(' bug ,  ui,backend ')).toEqual(['bug', 'ui', 'backend']);
	});

	it('drops empty entries', () => {
		expect(parseLabels(',, bug, ,ui,')).toEqual(['bug', 'ui']);
		expect(parseLabels('')).toEqual([]);
		expect(parseLabels('   ')).toEqual([]);
	});

	it('dedupes case-sensitively, keeping first occurrence order', () => {
		expect(parseLabels('bug, ui, bug, Bug')).toEqual(['bug', 'ui', 'Bug']);
	});
});

describe('formatLabels', () => {
	it('round-trips through parseLabels', () => {
		const labels = ['bug', 'needs triage', 'v2'];
		expect(parseLabels(formatLabels(labels))).toEqual(labels);
		expect(formatLabels([])).toBe('');
	});
});

describe('labelsEqual', () => {
	it('compares by value and order', () => {
		expect(labelsEqual(['a', 'b'], ['a', 'b'])).toBe(true);
		expect(labelsEqual(['a', 'b'], ['b', 'a'])).toBe(false);
		expect(labelsEqual(['a'], ['a', 'b'])).toBe(false);
		expect(labelsEqual([], [])).toBe(true);
	});
});
