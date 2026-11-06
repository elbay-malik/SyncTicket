import { afterEach, describe, expect, it, vi } from 'vitest';
import { isIssueId } from './issue.js';
import { randomUUID, uuidFromBytes } from './uuid.js';
import { createWorkspaceId, isWorkspaceId } from './workspace.js';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('randomUUID', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('uses crypto.randomUUID when the browser has it', () => {
		const id = randomUUID();
		expect(id).toMatch(V4);
		expect(isIssueId(id)).toBe(true);
	});

	describe('in a browser without crypto.randomUUID (an iPhone that went black)', () => {
		function stubWithoutRandomUUID() {
			const real = globalThis.crypto;
			vi.stubGlobal('crypto', {
				getRandomValues: (array: Uint8Array<ArrayBuffer>) => real.getRandomValues(array)
			});
		}

		it('still mints valid, distinct issue ids', () => {
			stubWithoutRandomUUID();
			const ids = new Set(Array.from({ length: 1000 }, () => randomUUID()));
			expect(ids.size).toBe(1000);
			for (const id of ids) {
				expect(id).toMatch(V4);
				expect(isIssueId(id)).toBe(true);
			}
		});

		it('still mints a valid workspace id, which is what threw during hydration', () => {
			stubWithoutRandomUUID();
			expect(isWorkspaceId(createWorkspaceId())).toBe(true);
		});
	});

	it('sets the version and variant bits whatever the bytes are', () => {
		expect(uuidFromBytes(new Uint8Array(16).fill(0xff))).toBe(
			'ffffffff-ffff-4fff-bfff-ffffffffffff'
		);
		expect(uuidFromBytes(new Uint8Array(16))).toBe('00000000-0000-4000-8000-000000000000');
	});
});
