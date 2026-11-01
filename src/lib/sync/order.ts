// Fractional order keys, and the repair that keeps them usable in a CRDT.
//
// Lives in sync/ rather than model/ because it depends on fractional-indexing, and model/
// is required to have zero runtime deps (AGENTS.md). It is still pure and Node-testable.
//
// The hard part is not generating keys, it is surviving keys generated *concurrently*.
// `generateKeyBetween` throws when its two bounds are equal, and two replicas working
// offline mint identical keys as a matter of course: both call generateKeyBetween(null,
// null) for their first issue and both get "a0". Sorting already converges on those (the
// id tiebreak in model/query.ts), but a drag between two equal keys would throw. Two
// defences below: jitter makes fresh collisions vanishingly unlikely, and planRepairs
// heals the ones that already exist.
//
// The other hard part is that a key is a peer's string. fractional-indexing checks only some of
// what it needs, so isOrderKey below decides what may ever reach it.

import { BASE_62_DIGITS, generateKeyBetween } from 'fractional-indexing';

/** The subset of an issue this module needs: a stable id and its current order key. */
export interface Ordered {
	id: string;
	order: string;
}

/** Digits usable in a jitter suffix. '0' is excluded: a key ending in '0' is invalid. */
const JITTER_DIGITS = BASE_62_DIGITS.slice(1);
const JITTER_LENGTH = 4;

/** The middle digit, which is what the library itself mints when nothing bounds it from above. */
const MIDDLE_DIGIT = 'V';

/** Which char codes are base-62 digits. Anything past the end of the table reads as not one. */
const IS_DIGIT = new Uint8Array(128);
for (const digit of BASE_62_DIGITS) IS_DIGIT[digit.charCodeAt(0)] = 1;

const CODE_ZERO = '0'.charCodeAt(0);

/** The one well-formed string the library refuses: the integer with nothing below it. */
const SMALLEST_INTEGER = `A${'0'.repeat(26)}`;

/**
 * Whether a string is an order key, by the rules fractional-indexing relies on: the first
 * character says how long the integer part is ('a' or 'Z' is 2, up to 'z' or 'A' at 27), every
 * character after it is a base-62 digit, and a fraction doesn't end in '0'.
 *
 * Asking the library is no substitute, in either direction. Appending after 'a0.' or 'aé' just
 * returns 'a1', because it never looks at a fraction it isn't using, and then the same key used
 * as a bound quietly produces garbage: 'a0' and an emoji mints 'a0undefinedundefinedV'. And it
 * can refuse its own output, as keyBetween below explains.
 *
 * There is deliberately no length limit. A real key grows each time a card is dropped into the
 * same slot, and a key's length is no more dangerous than a title's.
 *
 * This runs on every read of every issue, so it allocates nothing: about 20 ns for a usual key.
 */
export function isOrderKey(key: string): boolean {
	const head = key.charCodeAt(0);
	let integerLength: number;
	if (head >= 97 && head <= 122) integerLength = head - 95;
	else if (head >= 65 && head <= 90) integerLength = 92 - head;
	else return false;
	if (key.length < integerLength) return false;
	if (key.length > integerLength && key.charCodeAt(key.length - 1) === CODE_ZERO) return false;
	for (let index = 1; index < key.length; index += 1) {
		if (IS_DIGIT[key.charCodeAt(index)] !== 1) return false;
	}
	return key !== SMALLEST_INTEGER;
}

/**
 * A short random suffix appended to generated keys so that two replicas generating "the
 * same" key concurrently do not actually collide. 61^4 ≈ 13.8M combinations per position.
 *
 * Appending to a key leaves it valid — the integer part is unchanged and the fraction only
 * grows — provided the last character is never '0', which fractional-indexing rejects.
 */
function jitter(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(JITTER_LENGTH));
	let suffix = '';
	for (const byte of bytes) suffix += JITTER_DIGITS[byte % JITTER_DIGITS.length];
	return suffix;
}

/** A missing or invalid order key means "unordered", never a key to compute against. */
function bound(key: string | null | undefined): string | null {
	return key && isOrderKey(key) ? key : null;
}

/**
 * Whether an error is the engine running out of stack. V8 and JavaScriptCore call that a
 * RangeError and SpiderMonkey an InternalError, a global the others don't have, so it can only be
 * recognised by name. The library refuses a bound with a plain Error, which is neither.
 */
function isStackOverflow(error: unknown): boolean {
	return error instanceof RangeError || (error instanceof Error && error.name === 'InternalError');
}

/**
 * `generateKeyBetween` for two valid bounds in order, without the two ways it still fails them.
 *
 * Below the integer just above the smallest it returns the smallest, which it then refuses as a
 * bound. Any fraction makes that valid, and it still sorts below the integer it was asked about.
 *
 * And its midpoint recurses once per 'z' at the start of what is left of `lower`, so a run of
 * about 8,000 overflows the stack on a key that is valid. A limit would have to guess how much
 * stack the caller left, so this catches the overflow instead. It can only happen once `lower`
 * has differed from `upper`, so extending `lower` stays below `upper`, and no shorter key exists:
 * anything above `lower` has to carry the whole run too.
 */
function keyBetween(lower: string | null, upper: string | null): string {
	let key: string;
	try {
		key = generateKeyBetween(lower, upper);
	} catch (error) {
		if (lower === null || !isStackOverflow(error)) throw error;
		return lower + MIDDLE_DIGIT;
	}
	return key === SMALLEST_INTEGER ? key + MIDDLE_DIGIT : key;
}

/**
 * `count` unjittered keys in order between two bounds, each of which may be null. This is
 * `generateNKeysBetween` over {@link keyBetween}, since the library's can't be given another.
 */
export function orderKeysBetween(
	lower: string | null,
	upper: string | null,
	count: number
): string[] {
	if (count <= 0) return [];
	if (lower !== null && upper !== null) {
		const middle = keyBetween(lower, upper);
		const below = Math.floor(count / 2);
		return [
			...orderKeysBetween(lower, middle, below),
			middle,
			...orderKeysBetween(middle, upper, count - below - 1)
		];
	}
	const keys: string[] = [];
	let edge = lower ?? upper;
	for (let index = 0; index < count; index += 1) {
		edge = upper === null ? keyBetween(edge, null) : keyBetween(null, edge);
		keys.push(edge);
	}
	return upper === null ? keys : keys.reverse();
}

/** Key that sorts after every existing key. Used when appending a new issue. */
export function appendOrderKey(max: string | null, suffix: () => string = jitter): string {
	return keyBetween(bound(max), null) + suffix();
}

/** How many times to descend towards `next` looking for room to fit a jittered key. */
const JITTER_ATTEMPTS = 5;

/**
 * Key that sorts strictly between `prev` and `next` (either may be null for "no bound").
 *
 * Callers must pass strictly increasing bounds — run planRepairs first if the list may
 * contain duplicates, since equal bounds make generateKeyBetween throw.
 *
 * Jitter cannot simply be appended: `generateKeyBetween` often returns a proper *prefix* of
 * `next` (dropping above a card that itself carries a suffix is the common case), and
 * appending to a prefix of `next` sorts past it. Surrendering the jitter there would be
 * worse than useless — that is the most frequent drop on a board, so both replicas would
 * mint the identical deterministic key and the collisions this module exists to prevent
 * would come straight back. Instead, descend towards `next` and try again; each step is
 * still strictly greater than `prev`, so the bounds hold however early we stop.
 */
export function orderKeyBetween(
	prev: string | null,
	next: string | null,
	suffix: () => string = jitter
): string {
	const upper = bound(next);
	let key = keyBetween(bound(prev), upper);
	for (let attempt = 0; attempt < JITTER_ATTEMPTS; attempt += 1) {
		const jittered = key + suffix();
		if (upper === null || jittered < upper) return jittered;
		key = keyBetween(key, upper);
	}
	return key;
}

/**
 * Returns the minimal set of `{id, order}` changes that make `items` strictly increasing,
 * or `[]` when they already are — which is the normal case, so a healthy board pays
 * nothing. `items` must be in the order they are displayed in.
 *
 * Whatever is not a key counts as damage, not only the blank that `readIssue` reports for one, so
 * nothing but a valid key can become a bound here, whoever the caller is.
 *
 * Only the offending run is rekeyed rather than the whole column: Phase 6 targets 10k
 * issues, and a full rewrite would be thousands of CRDT writes for a cosmetic problem.
 */
export function planRepairs(items: readonly Ordered[]): Ordered[] {
	const isAbove = (order: string, lower: string | null) =>
		isOrderKey(order) && (lower === null || order > lower);
	const repairs: Ordered[] = [];
	let previous: string | null = null;
	let index = 0;
	while (index < items.length) {
		const current = items[index];
		if (!current) break;
		if (isAbove(current.order, previous)) {
			previous = current.order;
			index += 1;
			continue;
		}
		// items[index] collides with (or precedes) its predecessor. Extend the run over every
		// following item that is also not above `previous`, then mint fresh keys for the run
		// between `previous` and the first healthy key after it.
		let end = index;
		while (end < items.length) {
			const candidate = items[end];
			if (!candidate) break;
			if (isAbove(candidate.order, previous)) break;
			end += 1;
		}
		const upper = items[end]?.order ?? null;
		const keys = orderKeysBetween(previous, upper, end - index);
		for (let offset = 0; offset < keys.length; offset += 1) {
			const item = items[index + offset];
			const order = keys[offset];
			if (item && order !== undefined) repairs.push({ id: item.id, order });
		}
		previous = keys[keys.length - 1] ?? previous;
		index = end;
	}
	return repairs;
}
