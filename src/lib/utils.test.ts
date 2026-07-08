import { describe, expect, it } from 'vitest';
import { cn } from './utils.js';

describe('cn', () => {
	it('merges conditional classes and resolves tailwind conflicts', () => {
		expect(cn('p-2', 'p-4')).toBe('p-4');
		expect(cn('text-sm', undefined, 'font-medium')).toBe('text-sm font-medium');
	});
});
