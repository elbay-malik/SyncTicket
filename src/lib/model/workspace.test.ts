import { describe, expect, it } from 'vitest';
import {
	DEFAULT_WORKSPACE_ID,
	chooseWorkspace,
	createWorkspaceId,
	isWorkspaceId,
	linkedWorkspaceId,
	readVisited,
	rememberVisit,
	VISITED_LIMIT,
	workspaceAddress,
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
		const shared = createWorkspaceId();
		expect(chooseWorkspace(`?ws=${shared}`, REMEMBERED).id).toBe(shared);
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

	it('refuses a link whose id was damaged on the way, instead of opening a dead workspace', () => {
		// The regression: a share link cut short by a chat client, or missing one character,
		// passed the storage check, opened an empty workspace the relay refuses, said "you're
		// offline" while the network was fine, and replaced the remembered workspace with it.
		const real = createWorkspaceId();
		for (const damaged of [real.slice(0, -1), real.slice(0, 18), `${real}0`, 'garbage', 'w123']) {
			const resolution = chooseWorkspace(`?ws=${damaged}`, REMEMBERED);
			expect(resolution.id).toBe(REMEMBERED);
			expect(resolution.invalidParam).toBe(damaged);
		}
	});

	it('reads an upper-cased link as the id it was, since ids are lower-case hex', () => {
		const real = createWorkspaceId();
		const resolution = chooseWorkspace(`?ws=${real.toUpperCase()}`, REMEMBERED);
		expect(resolution.id).toBe(real);
		expect(resolution.invalidParam).toBeNull();
	});

	it('still reloads into a remembered id of an older shape when the address names it', () => {
		// Storage keeps accepting any usable id, so a browser that holds one is not stranded by
		// the stricter rule for links when the address bar is written back and reloaded.
		const legacy = 'older-shape_id';
		expect(chooseWorkspace(`?ws=${legacy}`, legacy)).toMatchObject({
			id: legacy,
			invalidParam: null
		});
		expect(chooseWorkspace(`?ws=${legacy}`, REMEMBERED).id).toBe(REMEMBERED);
	});

	it('goes back to a workspace of an older shape this browser has opened', () => {
		// Both ways back after following someone's link land on `?ws=<previous>`, and by then
		// the remembered id is the link's. Without the visited list a previous workspace of an
		// older shape was refused as a damaged link, and could no longer be reached at all.
		const legacy = 'older-shape_id';
		const shared = createWorkspaceId();
		expect(chooseWorkspace(`?ws=${shared}`, legacy).leftBehind).toBe(legacy);
		expect(chooseWorkspace(`?ws=${legacy}`, shared, [shared, legacy])).toMatchObject({
			id: legacy,
			invalidParam: null,
			leftBehind: null
		});
		// And the address check agrees, so the visit reloads into it instead of rewriting it.
		const address = workspaceAddress(new URL(`https://example.test/issues?ws=${legacy}`), shared, [
			shared,
			legacy
		]);
		expect(address).toEqual({ kind: 'reload' });
	});

	it('says which workspace a link took this browser away from, the first time only', () => {
		const shared = createWorkspaceId();
		expect(chooseWorkspace(`?ws=${shared}`, REMEMBERED).leftBehind).toBe(REMEMBERED);
		// A workspace this browser has opened before is a return, not a new arrival.
		expect(chooseWorkspace(`?ws=${shared}`, REMEMBERED, [shared]).leftBehind).toBeNull();
		// Nothing was left behind when nothing was remembered, or nothing changed.
		expect(chooseWorkspace(`?ws=${shared}`, null).leftBehind).toBeNull();
		expect(chooseWorkspace(`?ws=${REMEMBERED}`, REMEMBERED).leftBehind).toBeNull();
		expect(chooseWorkspace('', REMEMBERED).leftBehind).toBeNull();
		expect(chooseWorkspace('?ws=garbage', REMEMBERED).leftBehind).toBeNull();
	});

	it('says nothing when there was no parameter to complain about', () => {
		expect(chooseWorkspace('', null).invalidParam).toBeNull();
		expect(chooseWorkspace('?other=1', REMEMBERED).invalidParam).toBeNull();
		expect(chooseWorkspace(`?ws=${REMEMBERED}`, null).invalidParam).toBeNull();
	});
});

describe('workspaceAddress', () => {
	const at = (href: string) => workspaceAddress(new URL(href, 'https://example.test'), REMEMBERED);
	/** The href a `replace` asks for, so a wrong kind fails as loudly as a wrong URL. */
	const replacedWith = (href: string) => {
		const address = at(href);
		expect(address.kind).toBe('replace');
		return address.kind === 'replace' ? address.url.href : null;
	};

	it('leaves an address that already names this workspace alone', () => {
		// The steady state, and the only one that must not navigate: every other answer costs a
		// history rewrite, and answering `replace` here would loop on every navigation.
		expect(at(`/issues?ws=${REMEMBERED}`)).toEqual({ kind: 'keep' });
		expect(at(`/board?ws=${REMEMBERED}#main-content`)).toEqual({ kind: 'keep' });
	});

	it('puts the workspace back on a bare path, which is where every internal link lands', () => {
		// The regression: an evaluator copying this address bar to a phone got a fresh, empty
		// workspace, because the id lived only in this browser's storage.
		expect(replacedWith('/issues')).toBe(`https://example.test/issues?ws=${REMEMBERED}`);
		expect(replacedWith('/board')).toBe(`https://example.test/board?ws=${REMEMBERED}`);
	});

	it('keeps the path, other parameters and the hash, so an open sheet stays open', () => {
		const issue = '/issues/0b7f3c1e-8d2a-4f6b-9c3e-5a1d2e3f4a5b';
		expect(replacedWith(`${issue}?view=compact#main-content`)).toBe(
			`https://example.test${issue}?view=compact&ws=${REMEMBERED}#main-content`
		);
	});

	it('replaces an unusable id with the real one rather than leaving it to be copied on', () => {
		expect(replacedWith('/issues?ws=not%20a%20valid%20id!')).toBe(
			`https://example.test/issues?ws=${REMEMBERED}`
		);
		expect(replacedWith('/issues?ws=')).toBe(`https://example.test/issues?ws=${REMEMBERED}`);
		// The sentinel is unusable by design, so it is corrected like any other bad id.
		expect(replacedWith(`/issues?ws=${DEFAULT_WORKSPACE_ID}`)).toBe(
			`https://example.test/issues?ws=${REMEMBERED}`
		);
	});

	it('collapses a repeated parameter to one, even when the first copy is right', () => {
		expect(replacedWith(`/issues?ws=${REMEMBERED}&ws=w${'f'.repeat(32)}`)).toBe(
			`https://example.test/issues?ws=${REMEMBERED}`
		);
	});

	it('reloads rather than overwrite a different usable workspace someone was sent to', () => {
		const other = createWorkspaceId();
		expect(at(`/issues?ws=${other}`)).toEqual({ kind: 'reload' });
		// And the reload lands there: the URL's id beats the remembered one.
		expect(chooseWorkspace(`?ws=${other}`, REMEMBERED).id).toBe(other);
	});

	it('does not reload for a damaged id, which would fall back here and reload again for ever', () => {
		const real = createWorkspaceId();
		expect(replacedWith(`/issues?ws=${real.slice(0, -1)}`)).toBe(
			`https://example.test/issues?ws=${REMEMBERED}`
		);
		expect(replacedWith('/issues?ws=garbage')).toBe(`https://example.test/issues?ws=${REMEMBERED}`);
	});

	it('rewrites an upper-cased copy of this workspace instead of reloading into it', () => {
		expect(replacedWith(`/issues?ws=${REMEMBERED.toUpperCase()}`)).toBe(
			`https://example.test/issues?ws=${REMEMBERED}`
		);
	});

	it('produces an address that resolves back to the same workspace on any device', () => {
		const address = at('/board');
		expect(address.kind === 'replace' && chooseWorkspace(address.url.search, null).id).toBe(
			REMEMBERED
		);
	});
});

describe('linkedWorkspaceId', () => {
	it('takes only the shape the relay opens a room for', () => {
		const real = createWorkspaceId();
		expect(linkedWorkspaceId(real, [])).toBe(real);
		expect(linkedWorkspaceId(`t${real.slice(1)}`, [])).toBe(`t${real.slice(1)}`);
		expect(linkedWorkspaceId(real.slice(0, -1), [])).toBeNull();
		expect(linkedWorkspaceId('', [])).toBeNull();
		expect(linkedWorkspaceId(null, [])).toBeNull();
		expect(linkedWorkspaceId(DEFAULT_WORKSPACE_ID, [DEFAULT_WORKSPACE_ID])).toBeNull();
	});
});

describe('the visited list', () => {
	it('puts the workspace just opened first, then the one it replaced, without repeats', () => {
		const [a, b, c] = [createWorkspaceId(), createWorkspaceId(), createWorkspaceId()];
		expect(rememberVisit([], a, null)).toEqual([a]);
		expect(rememberVisit([b, c], a, b)).toEqual([a, b, c]);
		// A browser from before the list existed still gets its remembered workspace listed.
		expect(rememberVisit([], a, c)).toEqual([a, c]);
		expect(rememberVisit([a, b], a, a)).toEqual([a, b]);
	});

	it('keeps a bounded number', () => {
		const many = Array.from({ length: VISITED_LIMIT + 5 }, () => createWorkspaceId());
		expect(rememberVisit(many, createWorkspaceId(), null)).toHaveLength(VISITED_LIMIT);
	});

	it('ignores anything in storage that is not a list of usable ids', () => {
		const a = createWorkspaceId();
		expect(readVisited(null)).toEqual([]);
		expect(readVisited('nope')).toEqual([]);
		expect(readVisited({ 0: a })).toEqual([]);
		expect(readVisited([a, 42, 'a/b', DEFAULT_WORKSPACE_ID, null])).toEqual([a]);
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
