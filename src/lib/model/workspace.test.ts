import { describe, expect, it } from 'vitest';
import {
	DEFAULT_WORKSPACE_ID,
	isWorkspaceId,
	resolveWorkspaceId,
	workspaceDbName
} from './workspace.js';

describe('isWorkspaceId', () => {
	it('accepts ids usable in both a database name and a room name', () => {
		expect(isWorkspaceId('default')).toBe(true);
		expect(isWorkspaceId('a1b2-c3d4_e5')).toBe(true);
		expect(isWorkspaceId(crypto.randomUUID())).toBe(true);
	});

	it('rejects anything that could change the meaning of either name', () => {
		expect(isWorkspaceId('')).toBe(false);
		expect(isWorkspaceId('has space')).toBe(false);
		expect(isWorkspaceId('slash/es')).toBe(false);
		expect(isWorkspaceId('colon:name')).toBe(false);
		expect(isWorkspaceId('x'.repeat(65))).toBe(false);
		expect(isWorkspaceId(null)).toBe(false);
		expect(isWorkspaceId(42)).toBe(false);
	});
});

describe('resolveWorkspaceId', () => {
	it('prefers the id in the URL', () => {
		expect(resolveWorkspaceId('?ws=from-url', 'remembered')).toBe('from-url');
	});

	it('falls back to the remembered id, then to the default', () => {
		expect(resolveWorkspaceId('', 'remembered')).toBe('remembered');
		expect(resolveWorkspaceId('?other=1', null)).toBe(DEFAULT_WORKSPACE_ID);
		expect(resolveWorkspaceId('', null)).toBe(DEFAULT_WORKSPACE_ID);
	});

	it('ignores an unusable id from either source rather than trusting it', () => {
		expect(resolveWorkspaceId('?ws=has%20space', null)).toBe(DEFAULT_WORKSPACE_ID);
		expect(resolveWorkspaceId('?ws=a/b', 'good-one')).toBe('good-one');
		expect(resolveWorkspaceId('', 'bad/remembered')).toBe(DEFAULT_WORKSPACE_ID);
	});
});

describe('workspaceDbName', () => {
	it('namespaces the database per workspace', () => {
		expect(workspaceDbName('default')).toBe('syncticket:default');
		expect(workspaceDbName('abc')).not.toBe(workspaceDbName('abd'));
	});
});
