// What a peer can store as an issue's `order`, delivered from another replica. fractional-indexing
// fails on such a key in three different ways, and all three are pinned here: it throws, it
// accepts the key and returns garbage, or it overflows the stack on a key that is perfectly valid.
// The store's half is in state/junk-entries.svelte.test.ts.

import { describe, expect, it } from 'vitest';
import { generateKeyBetween } from 'fractional-indexing';
import * as Y from 'yjs';
import { sortIssues } from '$lib/model/query.js';
import { ISSUE_STATUSES, type IssueStatus } from '$lib/model/issue.js';
import { createDoc, getIssuesMap, type IssuesMap } from './doc.js';
import { createIssue, moveIssue, nextOrderKey, readAllIssues, readIssue } from './issues.js';
import { peerWrites } from './junk-entries.fixture.js';
import { appendOrderKey, isOrderKey, orderKeyBetween, planRepairs } from './order.js';
import { seedDemoIssues, seedIssues } from './seed.js';

const zeros = (count: number) => '0'.repeat(count);

/** The one well-formed string fractional-indexing refuses: the integer nothing is below. */
const SMALLEST = `A${zeros(26)}`;
/** The integer just above it, which is valid and is what makes the library return SMALLEST. */
const ABOVE_SMALLEST = `A${zeros(25)}1`;
/** The largest integer. Past it, the library has to grow a fraction. */
const LARGEST = 'z'.repeat(27);
/** Long enough that the library's recursive midpoint overflows the stack on a run of 'z's. */
const OVERFLOWING = 100_000;

interface Hostile {
	name: string;
	key: unknown;
}

const named = (...keys: string[]): Hostile[] => keys.map((key) => ({ name: `'${key}'`, key }));

/** Strings that are not keys: each is mapped to '' by a read and rekeyed by the next move. */
const INVALID_KEYS: readonly Hostile[] = [
	...named('~', 'zz', 'Z', 'a00', 'a0.', 'aé', 'a0 ', ' a0', 'a', 'é', '\0', 'a0\n', 'a.', 'b0'),
	{ name: 'blank', key: '' },
	{ name: 'the smallest integer', key: SMALLEST },
	{ name: 'a trailing zero after the smallest integer', key: `${SMALLEST}0` },
	{ name: 'a lone high surrogate', key: 'a0\uD800' },
	{ name: 'a lone low surrogate', key: 'a0\uDC00V' },
	{ name: 'only a lone surrogate', key: '\uD83D' },
	{ name: 'an emoji in the fraction', key: 'a0\u{1F600}' },
	{ name: 'an emoji for a head', key: '\u{1F600}a0' },
	// U+0161 has the low byte of 'a', so anything that read a byte rather than a character is fooled.
	{ name: 'a head past the single-byte range', key: 'š0' },
	{ name: 'a long run of junk fraction', key: `a0${'.'.repeat(10_000)}` },
	{ name: 'a long run of trailing zeros', key: `a0${zeros(10_000)}` },
	{ name: 'a long valid-looking key spoiled at the end', key: `a0${'V'.repeat(10_000)}~` },
	{ name: 'an integer part that is too short', key: `z${'z'.repeat(25)}` }
];

/** A Y.Text can only be integrated once, so {@link plant} makes a new one for each use. */
const Y_TEXT = Symbol('a Y.Text');

/** What else a peer can put in the field. A read has never trusted the type. */
const NON_STRINGS: readonly Hostile[] = [
	{ name: 'a number', key: 42 },
	{ name: 'null', key: null },
	{ name: 'true', key: true },
	{ name: 'a plain object', key: { order: 'a0' } },
	{ name: 'a Y.Text', key: Y_TEXT }
];

/**
 * Keys the library's rules allow, so they are kept, however unkind. There is deliberately no
 * length limit in here: a real key grows with every drop into the same slot.
 */
const VALID_BUT_UNKIND: readonly Hostile[] = [
	{ name: 'the largest integer', key: LARGEST },
	{ name: 'the integer above the smallest', key: ABOVE_SMALLEST },
	{ name: 'a fraction on the smallest integer', key: `${SMALLEST}1` },
	{ name: 'a long run of zeros on the smallest integer', key: `${SMALLEST}${zeros(10_000)}1` },
	{ name: 'a long fraction', key: `a0${'V'.repeat(10_000)}` },
	{ name: 'an overflowing run of z', key: `a0${'z'.repeat(OVERFLOWING)}` },
	{ name: 'an overflowing run on the largest integer', key: LARGEST + 'z'.repeat(OVERFLOWING) },
	{ name: 'an overflowing run in the middle', key: `a0V${'z'.repeat(OVERFLOWING)}V` }
];

const STRINGS = [...INVALID_KEYS, ...VALID_BUT_UNKIND];
const EVERYTHING = [...STRINGS, ...NON_STRINGS];

/** A peer writes `key` to the card `id`, and it arrives from their replica. */
function plant(doc: Y.Doc, id: string, key: unknown) {
	peerWrites(doc, (issues) =>
		(issues.get(id) as Y.Map<unknown>).set('order', key === Y_TEXT ? new Y.Text('a0') : key)
	);
}

/** A column in the order a visitor sees it, which is what the board hands to moveIssue. */
function column(map: IssuesMap, status: IssueStatus = 'todo') {
	return sortIssues(
		readAllIssues(map).filter((issue) => issue.status === status),
		'manual'
	);
}

function expectHealthy(map: IssuesMap, status: IssueStatus = 'todo') {
	const orders = column(map, status).map((issue) => issue.order);
	// Booleans rather than the strings, so a failure on a long key doesn't print all of it.
	expect(orders.map(isOrderKey)).toEqual(orders.map(() => true));
	for (let index = 1; index < orders.length; index += 1) {
		expect((orders[index] as string) > (orders[index - 1] as string)).toBe(true);
	}
}

/** Every issue in the replica, in a shape that is comparable between replicas. */
function everything(map: IssuesMap) {
	return readAllIssues(map).sort((a, b) => (a.id < b.id ? -1 : 1));
}

function deliver(from: Y.Doc, to: Y.Doc) {
	Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
}

/**
 * Four cards in a column and one waiting in another, a peer's `key` on the one numbered `slot`,
 * and a healthy replica that has received all of it.
 */
function workspace(key: unknown, slot = 1) {
	const doc = createDoc();
	const map = getIssuesMap(doc);
	const cards = ['One', 'Two', 'Three', 'Four'].map((title) =>
		createIssue(map, { title, status: 'todo' })
	);
	const waiting = createIssue(map, { title: 'Waiting', status: 'done' });
	const poisoned = cards[slot] as string;
	plant(doc, poisoned, key);

	const witness = createDoc();
	deliver(doc, witness);
	return { doc, map, poisoned, waiting, witness, witnessMap: getIssuesMap(witness) };
}

function expectConverged(from: Y.Doc, to: Y.Doc) {
	deliver(from, to);
	deliver(to, from);
	const mine = everything(getIssuesMap(from));
	const theirs = everything(getIssuesMap(to));
	expect(mine.map((issue) => issue.id)).toEqual(theirs.map((issue) => issue.id));
	// Booleans for the same reason as in expectHealthy.
	expect(mine.map((issue, index) => issue.order === theirs[index]?.order)).toEqual(
		mine.map(() => true)
	);
	expect(mine.map((issue) => issue.status)).toEqual(theirs.map((issue) => issue.status));
}

/** The id list a drop of `moved` at `position` reports. */
function droppedAt(map: IssuesMap, moved: string, position: number): string[] {
	const ids = column(map)
		.map((issue) => issue.id)
		.filter((id) => id !== moved);
	ids.splice(position, 0, moved);
	return ids;
}

describe('isOrderKey', () => {
	it.each(
		named(
			'a0',
			'a1',
			'aV',
			'Zz',
			'Z0',
			'b00',
			'Yzz',
			'a0V',
			'a0G0V',
			'a01',
			'zzzzzzzzzzzzzzzzzzzzzzzzzzz',
			'zzzzzzzzzzzzzzzzzzzzzzzzzzzV',
			ABOVE_SMALLEST,
			`${SMALLEST}1`
		)
	)('accepts $name', ({ key }) => {
		expect(isOrderKey(key as string)).toBe(true);
	});

	it.each(VALID_BUT_UNKIND)('accepts $name', ({ key }) => {
		expect(isOrderKey(key as string)).toBe(true);
	});

	it('has no length limit', () => {
		expect(isOrderKey(`a0${'V'.repeat(1_000_000)}`)).toBe(true);
	});

	it.each(INVALID_KEYS)('rejects $name', ({ key }) => {
		expect(isOrderKey(key as string)).toBe(false);
	});

	it('knows the integer length of every head, as the library does', () => {
		const heads = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
		for (const head of heads) {
			// The library's own answer: only the correct length is accepted as a bound.
			const lengths = Array.from({ length: 30 }, (_, index) => index).filter((length) => {
				try {
					generateKeyBetween(head + zeros(length), null);
					return true;
				} catch {
					return false;
				}
			});
			if (head === 'A') {
				// Its only all-zero integer is SMALLEST itself, which the library refuses.
				expect(lengths).toEqual([]);
				expect(isOrderKey(ABOVE_SMALLEST)).toBe(true);
				expect(isOrderKey(`A${zeros(24)}1`)).toBe(false);
				expect(isOrderKey(`A${zeros(25)}`)).toBe(false);
				continue;
			}
			expect(lengths).toHaveLength(1);
			const expected = lengths[0];
			for (let length = 0; length < 30; length += 1) {
				expect(isOrderKey(head + zeros(length))).toBe(length === expected);
			}
		}
	});

	it('accepts exactly the base-62 digits, on every UTF-16 code unit', () => {
		const digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
		const wrong: number[] = [];
		for (let code = 0; code <= 0xffff; code += 1) {
			const char = String.fromCharCode(code);
			const isDigit = digits.includes(char);
			const isLetter = isDigit && code > 57;
			// In the fraction, then in the integer, then as the head of an otherwise fine key.
			if (isOrderKey(`a0${char}V`) !== isDigit) wrong.push(code);
			if (isOrderKey(`b${char}0`) !== isDigit) wrong.push(code);
			if (!isLetter && isOrderKey(`${char}0`)) wrong.push(code);
		}
		expect(wrong).toEqual([]);
	});

	it('agrees with the library on every short string, and is stricter only about digits', () => {
		const alphabet = ['0', '1', 'V', 'z', 'a', 'b', 'A', 'Z', 'Y', '.', 'é', '~', ' '];
		const accepted = (key: string) => {
			try {
				generateKeyBetween(key, null);
				generateKeyBetween(null, key);
				return true;
			} catch {
				return false;
			}
		};
		let strings = [''];
		for (let length = 0; length <= 4; length += 1) {
			for (const key of strings) {
				expect([key, isOrderKey(key)]).toEqual([key, accepted(key) && /^[0-9A-Za-z]+$/.test(key)]);
			}
			strings = strings.flatMap((key) => alphabet.map((char) => key + char));
		}
	});

	it('accepts what a real key can grow into through repeated drops in one slot', () => {
		// 500 drops build a run of 'z's that a length rule, or a rule about runs, would catch.
		let low = 'a0';
		for (let drop = 0; drop < 3000; drop += 1) {
			const key = orderKeyBetween(low, 'a1');
			expect(key > low && key < 'a1').toBe(true);
			expect(isOrderKey(key)).toBe(true);
			low = key;
		}
		expect(low.length).toBeGreaterThan(400);
	});
});

describe('key generation against the limits of the library', () => {
	it('never returns the smallest integer, which it would then refuse', () => {
		// generateKeyBetween(null, ABOVE_SMALLEST) really does return SMALLEST.
		expect(generateKeyBetween(null, ABOVE_SMALLEST)).toBe(SMALLEST);
		const below = orderKeyBetween(null, ABOVE_SMALLEST);
		expect(isOrderKey(below)).toBe(true);
		expect(below < ABOVE_SMALLEST).toBe(true);
		const withoutJitter = orderKeyBetween(null, ABOVE_SMALLEST, () => '');
		expect(isOrderKey(withoutJitter)).toBe(true);
		expect(withoutJitter < ABOVE_SMALLEST).toBe(true);
	});

	it.each([1, 2, 3, 10, 200])('repairs %i blank cards under the lowest keys there are', (count) => {
		for (const floor of [ABOVE_SMALLEST, `${SMALLEST}1`, `${SMALLEST}${zeros(10)}1`]) {
			const items = Array.from({ length: count }, (_, index) => ({ id: `${index}`, order: '' }));
			const repairs = planRepairs([...items, { id: 'floor', order: floor }]);
			expect(repairs.map((repair) => repair.id)).toEqual(items.map((item) => item.id));
			const keys = [...repairs.map((repair) => repair.order), floor];
			expect(keys.map(isOrderKey)).toEqual(keys.map(() => true));
			for (let index = 1; index < keys.length; index += 1) {
				expect((keys[index] as string) > (keys[index - 1] as string)).toBe(true);
			}
		}
	});

	it('keeps a key valid after jitter, wherever the jitter lands', () => {
		for (const key of ['a0', 'Zz', 'a0V', SMALLEST, ABOVE_SMALLEST, LARGEST]) {
			expect(isOrderKey(key + 'V')).toBe(true);
		}
		for (const [low, high] of [
			['a0', 'a1'],
			['a0', 'a0V'],
			['Zz', 'a0'],
			[null, 'a0'],
			[null, `${SMALLEST}1`],
			[null, ABOVE_SMALLEST],
			[LARGEST, null],
			[`${SMALLEST}1`, ABOVE_SMALLEST]
		] as Array<[string | null, string | null]>) {
			for (let attempt = 0; attempt < 50; attempt += 1) {
				expect(isOrderKey(orderKeyBetween(low, high))).toBe(true);
			}
		}
	});

	it('appends past the largest integer without end, strictly increasing', () => {
		let key = LARGEST;
		for (let append = 0; append < 2000; append += 1) {
			const next = appendOrderKey(key);
			expect(next > key).toBe(true);
			expect(isOrderKey(next)).toBe(true);
			key = next;
		}
	});

	it('survives a repair next to a key too long for the recursion in the library', () => {
		const long = `a0${'z'.repeat(OVERFLOWING)}`;
		for (const count of [1, 2, 7]) {
			const blanks = Array.from({ length: count }, (_, index) => ({ id: `${index}`, order: '' }));
			const repairs = planRepairs([
				{ id: 'long', order: long },
				...blanks,
				{ id: 'a1', order: 'a1' }
			]);
			const keys = [long, ...repairs.map((repair) => repair.order), 'a1'];
			expect(keys.map(isOrderKey)).toEqual(keys.map(() => true));
			for (let index = 1; index < keys.length; index += 1) {
				expect((keys[index] as string) > (keys[index - 1] as string)).toBe(true);
			}
		}
	});

	it('moves a card between that key and the only key that makes the library recurse', () => {
		const { doc, map, poisoned, waiting, witness } = workspace(`a0${'z'.repeat(OVERFLOWING)}`, 0);
		const next = column(map).find((issue) => issue.id !== poisoned)?.id as string;
		plant(doc, next, 'a1');
		const dropped = droppedAt(map, waiting, 1);
		expect(dropped.slice(0, 3)).toEqual([poisoned, waiting, next]);
		moveIssue(map, waiting, 'todo', dropped);
		expectHealthy(map);
		expect(column(map).map((issue) => issue.id)).toEqual(dropped);
		expectConverged(doc, witness);
	});

	it('survives a key too long for the recursion in the library', () => {
		const run = 'z'.repeat(OVERFLOWING);
		expect(() => generateKeyBetween(`a0${run}`, 'a1')).toThrow(RangeError);
		for (const [low, high] of [
			[`a0${run}`, 'a1'],
			[`a0V${run}`, 'a0W'],
			[`a0V${run}V`, 'a0W'],
			[LARGEST + run, null],
			[`a0${run}`, null]
		] as Array<[string, string | null]>) {
			const key = orderKeyBetween(low, high);
			expect(isOrderKey(key)).toBe(true);
			expect(key > low).toBe(true);
			if (high !== null) expect(key < high).toBe(true);
			expect(isOrderKey(appendOrderKey(low))).toBe(true);
		}
	});

	it.each(INVALID_KEYS.map((entry) => ({ ...entry, key: entry.key as string })))(
		'treats $name as no bound at all when handed one',
		({ key }) => {
			expect(isOrderKey(appendOrderKey(key))).toBe(true);
			const after = orderKeyBetween(key, null);
			expect(isOrderKey(after)).toBe(true);
			const before = orderKeyBetween(null, key);
			expect(isOrderKey(before)).toBe(true);
			const inside = orderKeyBetween(key, 'a5');
			expect(isOrderKey(inside) && inside < 'a5').toBe(true);
			const above = orderKeyBetween('a5', key);
			expect(isOrderKey(above) && above > 'a5').toBe(true);
		}
	);
});

describe.each(STRINGS)('planRepairs handed $name', ({ key }) => {
	const order = key as string;

	it.each([
		[[order]],
		[[order, 'a1']],
		[['a1', order]],
		[['a1', order, 'a5']],
		[[order, order, 'a5']],
		[['a1', order, order]],
		[['a1', order, 'a5', order]],
		[[order, ABOVE_SMALLEST]],
		[['a5', order, 'a1']]
	])('leaves a strictly increasing list of valid keys', (orders) => {
		const items = orders.map((value, index) => ({ id: `${index}`, order: value }));
		const repairs = new Map(planRepairs(items).map((repair) => [repair.id, repair.order]));
		const keys = items.map((item) => repairs.get(item.id) ?? item.order);
		expect(keys.map(isOrderKey)).toEqual(keys.map(() => true));
		for (let index = 1; index < keys.length; index += 1) {
			expect((keys[index] as string) > (keys[index - 1] as string)).toBe(true);
		}
	});
});

describe.each(INVALID_KEYS.concat(NON_STRINGS))('a card with $name for a key', ({ key }) => {
	it('reads as unordered, without anything being written', () => {
		const { doc, map, poisoned } = workspace(key);
		let writes = 0;
		doc.on('update', () => {
			writes += 1;
		});
		const issue = readAllIssues(map).find((candidate) => candidate.id === poisoned);
		expect(issue?.order).toBe('');
		expect(readIssue(poisoned, map.get(poisoned) as Y.Map<unknown>).order).toBe('');
		nextOrderKey(map);
		expect(writes).toBe(0);
		// Still there: nothing rewrote it just by looking at it.
		const stored = (map.get(poisoned) as Y.Map<unknown>).get('order');
		if (typeof key === 'string' && !/[\uD800-\uDFFF]/.test(key)) expect(stored === key).toBe(true);
	});

	it('does not raise the key the next issue is appended after', () => {
		const { map, poisoned } = workspace(key);
		const highest = readAllIssues(map)
			.filter((issue) => issue.id !== poisoned)
			.map((issue) => issue.order)
			.sort()
			.at(-1) as string;
		const appended = nextOrderKey(map);
		expect(appended > highest).toBe(true);
		// The very next integer: a key like 'zz' must not have pushed it anywhere.
		expect(appended.slice(0, 2)).toBe(generateKeyBetween(highest, null));
	});
});

describe.each(EVERYTHING)('with $name on one card', ({ key }) => {
	it('creates an issue at the end of the column', () => {
		const { doc, map, witness, witnessMap } = workspace(key);
		const id = createIssue(map, { title: 'New', status: 'todo' });
		const order = column(map);
		expect(order.at(-1)?.id).toBe(id);
		expect(isOrderKey(order.at(-1)?.order ?? '')).toBe(true);
		expectConverged(doc, witness);
		expect(column(witnessMap).at(-1)?.id).toBe(id);
	});

	it('creates an issue when it is the only card there is', () => {
		const doc = createDoc();
		const map = getIssuesMap(doc);
		const only = createIssue(map, { status: 'todo' });
		plant(doc, only, key);
		const id = createIssue(map, { title: 'New', status: 'todo' });
		expect(isOrderKey(column(map).at(-1)?.order ?? '')).toBe(true);
		expect(column(map).at(-1)?.id).toBe(id);
		moveIssue(map, id, 'todo', [id, only]);
		expectHealthy(map);
		expect(column(map).map((issue) => issue.id)).toEqual([id, only]);
	});

	it('seeds after the keys that are valid', () => {
		const { map } = workspace(key);
		const before = readAllIssues(map).map((issue) => issue.order);
		const ids = [...seedIssues(map, 3), ...seedDemoIssues(map)];
		const seeded = readAllIssues(map).filter((issue) => ids.includes(issue.id));
		expect(seeded.map((issue) => isOrderKey(issue.order))).toEqual(ids.map(() => true));
		for (const issue of seeded) {
			expect(before.every((order) => issue.order > order)).toBe(true);
		}
	});

	for (const mover of ['the card itself', 'a card beside it', 'a card from another column']) {
		it(`moves ${mover} to every position in the column`, () => {
			for (let position = 0; position < 5; position += 1) {
				const { doc, map, poisoned, waiting, witness } = workspace(key);
				const moved =
					mover === 'the card itself'
						? poisoned
						: mover === 'a card beside it'
							? (column(map).find((issue) => issue.id !== poisoned)?.id as string)
							: waiting;
				const length = column(map).filter((issue) => issue.id !== moved).length;
				if (position > length) continue;
				const dropped = droppedAt(map, moved, position);

				moveIssue(map, moved, 'todo', dropped);

				expectHealthy(map);
				expect(column(map).map((issue) => issue.id)).toEqual(dropped);
				expectConverged(doc, witness);
				expect(column(getIssuesMap(witness)).map((issue) => issue.id)).toEqual(dropped);
				// And the healthy peer can carry on from what it received.
				const again = droppedAt(getIssuesMap(witness), moved, 0);
				moveIssue(getIssuesMap(witness), moved, 'todo', again);
				expectHealthy(getIssuesMap(witness));
				expectConverged(witness, doc);
			}
		});
	}

	it('survives two healthy replicas repairing it at the same time', () => {
		const { doc, map, poisoned, witness, witnessMap } = workspace(key);
		const mine = column(map).find((issue) => issue.id !== poisoned)?.id as string;
		const theirs = column(map).findLast((issue) => issue.id !== poisoned)?.id as string;
		moveIssue(map, mine, 'todo', droppedAt(map, mine, 3));
		moveIssue(witnessMap, theirs, 'todo', droppedAt(witnessMap, theirs, 0));
		expectConverged(doc, witness);
		// Concurrent keys need not land where either drop asked, but the next one has to work.
		moveIssue(map, mine, 'todo', droppedAt(map, mine, 1));
		expectHealthy(map);
		expectConverged(doc, witness);
	});
});

describe('a replica under fire', () => {
	it('never throws and keeps converging, whatever peers leave behind', () => {
		// Deterministic, so a failure is reproducible from the seed.
		let seed = 20261101;
		const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
		const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)] as T;

		const noise = ['0', '1', 'V', 'z', 'a', 'A', 'Z', '.', '~', 'é', ' ', '\uD800', '\u{1F600}'];
		const randomKey = (): unknown => {
			const shape = random();
			if (shape < 0.3) return pick(EVERYTHING).key;
			if (shape < 0.6) {
				let key = '';
				for (let length = Math.floor(random() * 8); length > 0; length -= 1) key += pick(noise);
				return key;
			}
			// A real key with a small accident, which is what a buggy older client would write.
			const real = appendOrderKey(pick([null, 'a0', 'Zz', 'b00']));
			return shape < 0.8 ? real.slice(0, Math.floor(random() * real.length)) : real + pick(noise);
		};

		for (let trial = 0; trial < 150; trial += 1) {
			const one = createDoc();
			const two = createDoc();
			const oneMap = getIssuesMap(one);
			const twoMap = getIssuesMap(two);
			for (let index = 0; index < 5; index += 1) {
				createIssue(oneMap, { status: pick(['todo', 'done'] as const) });
			}
			deliver(one, two);

			for (let step = 0; step < 8; step += 1) {
				const map = random() < 0.5 ? oneMap : twoMap;
				const doc = map === oneMap ? one : two;
				const action = random();
				if (action < 0.35) {
					const victim = pick(readAllIssues(map)).id;
					const key = randomKey();
					plant(doc, victim, key);
				} else if (action < 0.5) {
					createIssue(map, { status: pick(['todo', 'done'] as const) });
				} else {
					const status = pick(ISSUE_STATUSES);
					const moved = pick(readAllIssues(map)).id;
					const position = Math.floor(random() * (column(map, status).length + 1));
					const ids = column(map, status)
						.map((issue) => issue.id)
						.filter((id) => id !== moved);
					ids.splice(position, 0, moved);
					moveIssue(map, moved, status, ids);
					expectHealthy(map, status);
					expect(column(map, status).map((issue) => issue.id)).toEqual(ids);
				}
				if (random() < 0.3) expectConverged(one, two);
			}
			expectConverged(one, two);
		}
	});
});
