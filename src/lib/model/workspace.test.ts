import { describe, expect, it } from 'vitest';
import {
	DEFAULT_WORKSPACE_ID,
	chooseWorkspace,
	createWorkspaceId,
	isWorkspaceId,
	workspaceDbName,
	workspaceShareUrl
} from './workspace.js';

/** A valid id of the shape the app actually mints, for tests that need a stable one. */
const REMEMBERED = 'w00000000000000000000000000000001';

describe('isWorkspaceId', () => {
	it('accepts ids usable in both a database name and a room name', () => {
		expect(isWorkspaceId('a1b2-c3d4_e5')).toBe(true);
		expect(isWorkspaceId(crypto.randomUUID())).toBe(true);
		expect(isWorkspaceId(createWorkspaceId())).toBe(true);
	});

	it('rejects the sentinel, which is the one id a stranger could guess', () => {
		// Not a style preference: after deploy this is a real Durable Object room, and an id
		// is the only thing protecting a workspace (ADR 0004). Rejecting it here is what makes
		// `?ws=default` unreachable from every source at once, storage included.
		expect(isWorkspaceId(DEFAULT_WORKSPACE_ID)).toBe(false);
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

describe('chooseWorkspace', () => {
	it('prefers the id in the URL', () => {
		expect(chooseWorkspace('?ws=from-url', REMEMBERED).id).toBe('from-url');
	});

	it('falls back to the remembered id', () => {
		expect(chooseWorkspace('', REMEMBERED).id).toBe(REMEMBERED);
		expect(chooseWorkspace('?other=1', REMEMBERED).id).toBe(REMEMBERED);
	});

	it('mints an unguessable id when neither source has one', () => {
		for (const search of ['', '?other=1', '?ws=a/b']) {
			const { id } = chooseWorkspace(search, null);
			expect(id).toMatch(/^w[0-9a-f]{32}$/);
			expect(id).not.toBe(DEFAULT_WORKSPACE_ID);
		}
		// Two visitors in that position must not end up in the same room.
		expect(chooseWorkspace('', null).id).not.toBe(chooseWorkspace('', null).id);
	});

	it('ignores an unusable id from either source rather than trusting it', () => {
		expect(chooseWorkspace('?ws=has%20space', REMEMBERED).id).toBe(REMEMBERED);
		expect(chooseWorkspace('?ws=a/b', REMEMBERED).id).toBe(REMEMBERED);
		expect(chooseWorkspace('', 'bad/remembered').id).toMatch(/^w[0-9a-f]{32}$/);
	});

	it('never lands a session in the guessable workspace, from any source', () => {
		// The regression: `?ws=default` used to resolve to the literal workspace 'default' for
		// any browser that had been here before, and the caller then wrote it to localStorage
		// as that browser's permanent workspace. It is the one room anyone can walk into.
		const fromLink = chooseWorkspace(`?ws=${DEFAULT_WORKSPACE_ID}`, REMEMBERED);
		expect(fromLink.id).toBe(REMEMBERED);

		const firstVisit = chooseWorkspace(`?ws=${DEFAULT_WORKSPACE_ID}`, null);
		expect(firstVisit.id).toMatch(/^w[0-9a-f]{32}$/);

		// And a browser that was already stranded there is moved out on its next load.
		const stranded = chooseWorkspace('', DEFAULT_WORKSPACE_ID);
		expect(stranded.id).toMatch(/^w[0-9a-f]{32}$/);
	});

	it('reports a `ws` parameter that was present but unusable', () => {
		// Silently opening a different workspace is the failure this exists to prevent: the
		// visitor followed a link, and has no other way to learn they are not where it pointed.
		expect(chooseWorkspace('?ws=not%20a%20valid%20id!', null).invalidParam).toBe('not a valid id!');
		expect(chooseWorkspace('?ws=a/b', REMEMBERED).invalidParam).toBe('a/b');
		expect(chooseWorkspace(`?ws=${DEFAULT_WORKSPACE_ID}`, null).invalidParam).toBe(
			DEFAULT_WORKSPACE_ID
		);
		// Present and empty is still present — `?ws=` is a broken link, not an absent one.
		expect(chooseWorkspace('?ws=', null).invalidParam).toBe('');
	});

	it('says nothing when there was no parameter to complain about', () => {
		expect(chooseWorkspace('', null).invalidParam).toBeNull();
		expect(chooseWorkspace('?other=1', REMEMBERED).invalidParam).toBeNull();
		expect(chooseWorkspace(`?ws=${REMEMBERED}`, null).invalidParam).toBeNull();
	});
});

describe('workspaceDbName', () => {
	it('namespaces the database per workspace', () => {
		expect(workspaceDbName('default')).toBe('syncticket:default');
		expect(workspaceDbName('abc')).not.toBe(workspaceDbName('abd'));
	});
});

describe('createWorkspaceId', () => {
	it('mints ids that are valid, unique and not guessable', () => {
		const ids = Array.from({ length: 200 }, createWorkspaceId);
		for (const id of ids) expect(isWorkspaceId(id)).toBe(true);
		expect(new Set(ids).size).toBe(ids.length);
		// Long enough that knowing one tells you nothing about another — the id is the only
		// access control demo mode has.
		expect(ids[0]!.length).toBeGreaterThanOrEqual(32);
	});

	it('mints ids the relay will actually open a room for', () => {
		// workers/relay/src/rooms.ts only creates rooms named `^[a-z][0-9a-f]{32}$`, so a
		// change to the shape here silently costs every new workspace its relay.
		expect(createWorkspaceId()).toMatch(/^[a-z][0-9a-f]{32}$/);
	});
});

describe('workspaceShareUrl', () => {
	it('produces a link that resolves back to the same workspace', () => {
		const id = createWorkspaceId();
		const url = workspaceShareUrl('https://example.test', id);
		expect(url.startsWith('https://example.test/issues?')).toBe(true);
		expect(chooseWorkspace(new URL(url).search, null).id).toBe(id);
	});
});
