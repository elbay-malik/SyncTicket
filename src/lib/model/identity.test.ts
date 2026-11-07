import { describe, expect, it } from 'vitest';
import {
	secureRandom,
	workspaceUserId,
	MAX_NAME_LENGTH,
	PEER_HUES,
	createIdentity,
	initialsOf,
	normaliseName,
	parseIdentity,
	seededRandom
} from './identity.js';

/** Deterministic stand-in for Math.random, cycling through fixed values. */
function sequence(values: number[]): () => number {
	let i = 0;
	return () => values[i++ % values.length] as number;
}

describe('createIdentity', () => {
	it('produces a two-word name, a palette hue and a well-formed user id', () => {
		const identity = createIdentity(sequence([0, 0]));
		expect(identity.name.split(' ')).toHaveLength(2);
		expect(PEER_HUES).toContain(identity.hue);
		expect(identity.userId).toMatch(/^u[0-9a-f]{32}$/);
	});

	it('gives each browser a distinct user id', () => {
		const ids = new Set(Array.from({ length: 500 }, () => createIdentity().userId));
		expect(ids.size).toBe(500);
	});

	it('varies across browsers rather than always picking the same one', () => {
		const names = new Set(Array.from({ length: 200 }, () => createIdentity().name));
		expect(names.size).toBeGreaterThan(20);
	});

	it('only ever produces hues the UI can render', () => {
		for (let i = 0; i < 200; i += 1) {
			const { hue } = createIdentity();
			expect(hue).toBeGreaterThanOrEqual(0);
			expect(hue).toBeLessThan(360);
		}
	});
});

describe('normaliseName', () => {
	it('trims, collapses whitespace and caps the length', () => {
		expect(normaliseName('  Ada   Lovelace  ', 'Fallback')).toBe('Ada Lovelace');
		expect(normaliseName('x'.repeat(100), 'Fallback')).toHaveLength(MAX_NAME_LENGTH);
	});

	it('keeps the previous name rather than letting someone become nameless', () => {
		expect(normaliseName('', 'Amber Fox')).toBe('Amber Fox');
		expect(normaliseName('   ', 'Amber Fox')).toBe('Amber Fox');
	});

	it('leaves markup as literal text for the UI to escape', () => {
		// Svelte escapes interpolated text; the point here is that nothing is stripped
		// silently, so what a peer typed is what other peers see.
		expect(normaliseName('<b>bold</b>', 'x')).toBe('<b>bold</b>');
	});

	it('removes characters that would reorder or fake the text around them', () => {
		// U+202E reverses everything after it, which is how a name rewrites the row it sits in.
		expect(normaliseName('Ada\u202Ereversed', 'x')).toBe('Adareversed');
		// A zero-width space would let two peers wear the same visible name.
		expect(normaliseName('a\u200Bb', 'x')).toBe('ab');
		// A name that is nothing but control characters is not a name.
		expect(normaliseName('\u202E\u200B', 'Amber Fox')).toBe('Amber Fox');
	});

	it('folds newlines and tabs into spaces instead of deleting them', () => {
		expect(normaliseName('Ada\nLovelace', 'x')).toBe('Ada Lovelace');
		expect(normaliseName('Ada\tLovelace', 'x')).toBe('Ada Lovelace');
	});

	it('never returns a name with edge whitespace, even after truncation', () => {
		const truncated = normaliseName(`${'a'.repeat(MAX_NAME_LENGTH)}   tail`, 'x');
		expect(truncated).toBe(truncated.trim());
	});
});

describe('seededRandom', () => {
	it('gives the same sequence for the same seed and a different one otherwise', () => {
		const draw = (seed: string) => Array.from({ length: 5 }, seededRandom(seed));
		expect(draw('user-a')).toEqual(draw('user-a'));
		expect(draw('user-a')).not.toEqual(draw('user-b'));
	});

	it('stays inside the unit interval', () => {
		const next = seededRandom('anything');
		for (let i = 0; i < 500; i += 1) {
			const value = next();
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(1);
		}
	});
});

describe('initialsOf', () => {
	it('takes one letter from each of the first two words', () => {
		expect(initialsOf('Amber Fox')).toBe('AF');
		expect(initialsOf('Ada Lovelace Byron')).toBe('AL');
	});

	it('copes with one word and with nothing', () => {
		expect(initialsOf('Ada')).toBe('AD');
		expect(initialsOf('')).toBe('?');
		expect(initialsOf('   ')).toBe('?');
	});
});

describe('parseIdentity', () => {
	it('round-trips a stored identity', () => {
		const original = { userId: `u${'0'.repeat(32)}`, name: 'Ada Lovelace', hue: 210 };
		expect(parseIdentity(original)).toEqual(original);
	});

	it('replaces a user id that is not one, since it is echoed into the DOM as a key', () => {
		for (const bad of ['', 'not-an-id', 'u' + 'z'.repeat(32), `u${'0'.repeat(31)}`, 42, null]) {
			expect(parseIdentity({ userId: bad, name: 'Ada', hue: 10 }).userId).toMatch(
				/^u[0-9a-f]{32}$/
			);
		}
	});

	it('validates a peer the same way it validates what was stored', () => {
		// The remote case: every field is written by whoever holds the workspace link.
		const hostile = {
			userId: `u${'a'.repeat(32)}`,
			name: `Ada\u202E${'!'.repeat(80)}`,
			hue: 'oklch(50% .2 20); background-image: url(https://tracker.example/x)'
		};
		const peer = parseIdentity(hostile);
		expect(peer.name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
		expect(peer.name).not.toContain('\u202E');
		expect(typeof peer.hue).toBe('number');
	});

	it('repairs anything unusable instead of rendering it', () => {
		for (const broken of [null, undefined, 'a string', 42, {}, { name: 42, hue: 'blue' }]) {
			const identity = parseIdentity(broken);
			expect(identity.name.length).toBeGreaterThan(0);
			expect(identity.hue).toBeGreaterThanOrEqual(0);
			expect(identity.hue).toBeLessThan(360);
		}
	});

	it('rejects a hue outside the wheel', () => {
		expect(parseIdentity({ name: 'Ada', hue: 999 }).hue).toBeLessThan(360);
		expect(parseIdentity({ name: 'Ada', hue: -5 }).hue).toBeGreaterThanOrEqual(0);
	});
});

describe('workspaceUserId', () => {
	const a = 'w' + 'a'.repeat(32);
	const b = 'w' + 'b'.repeat(32);

	it('gives a browser a different id in each workspace, and the same one each time in one', () => {
		const first = workspaceUserId(null, a);
		const again = workspaceUserId(first.ids, a);
		const other = workspaceUserId(again.ids, b);
		expect(again.userId).toBe(first.userId);
		expect(other.userId).not.toBe(first.userId);
		expect(other.ids).toEqual({ [a]: first.userId, [b]: other.userId });
		for (const id of [first.userId, other.userId]) expect(id).toMatch(/^u[0-9a-f]{32}$/);
	});

	it('keeps only ids of the right shape from storage anyone on this origin can write', () => {
		const { ids } = workspaceUserId({ [a]: '<script>', [b]: 42, x: 'u' + '1'.repeat(32) }, a);
		expect(Object.keys(ids)).toEqual(['x', a]);
		expect(ids[a]).toMatch(/^u[0-9a-f]{32}$/);
		expect(workspaceUserId([1, 2], a).userId).toMatch(/^u[0-9a-f]{32}$/);
	});

	it('keeps a bounded number of workspaces', () => {
		let stored: Record<string, string> = {};
		for (let i = 0; i < 80; i++) stored = workspaceUserId(stored, `w${i}`).ids;
		expect(Object.keys(stored).length).toBeLessThanOrEqual(50);
		expect(stored).toHaveProperty('w79');
	});
});

describe('secureRandom', () => {
	it('draws numbers in [0, 1)', () => {
		for (let i = 0; i < 100; i++) {
			const n = secureRandom();
			expect(n).toBeGreaterThanOrEqual(0);
			expect(n).toBeLessThan(1);
		}
	});
});
