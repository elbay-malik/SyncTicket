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

import { BASE_62_DIGITS, generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/** The subset of an issue this module needs: a stable id and its current order key. */
export interface Ordered {
	id: string;
	order: string;
}

/** Digits usable in a jitter suffix. '0' is excluded: a key ending in '0' is invalid. */
const JITTER_DIGITS = BASE_62_DIGITS.slice(1);
const JITTER_LENGTH = 4;

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

/** A missing or blank order key means "unordered", never a key to compute against. */
function bound(key: string | null | undefined): string | null {
	return key ? key : null;
}

/** Key that sorts after every existing key. Used when appending a new issue. */
export function appendOrderKey(max: string | null, suffix: () => string = jitter): string {
	return generateKeyBetween(bound(max), null) + suffix();
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
	let key = generateKeyBetween(bound(prev), upper);
	for (let attempt = 0; attempt < JITTER_ATTEMPTS; attempt += 1) {
		const jittered = key + suffix();
		if (upper === null || jittered < upper) return jittered;
		key = generateKeyBetween(key, upper);
	}
	return key;
}

/**
 * Returns the minimal set of `{id, order}` changes that make `items` strictly increasing,
 * or `[]` when they already are — which is the normal case, so a healthy board pays
 * nothing. `items` must be in the order they are displayed in.
 *
 * Only the offending run is rekeyed rather than the whole column: Phase 6 targets 10k
 * issues, and a full rewrite would be thousands of CRDT writes for a cosmetic problem.
 */
export function planRepairs(items: readonly Ordered[]): Ordered[] {
	const repairs: Ordered[] = [];
	let previous: string | null = null;
	let index = 0;
	while (index < items.length) {
		const current = items[index];
		if (!current) break;
		// A blank key is not merely out of order, it is not a key at all: readIssue defaults a
		// missing `order` to '', and feeding that to fractional-indexing throws a TypeError.
		// Treat it as damage to repair rather than as a bound to measure against.
		if (current.order !== '' && (previous === null || current.order > previous)) {
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
			if (candidate.order !== '' && (previous === null || candidate.order > previous)) break;
			end += 1;
		}
		const upper = items[end]?.order ?? null;
		const keys = generateNKeysBetween(previous, upper, end - index);
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
