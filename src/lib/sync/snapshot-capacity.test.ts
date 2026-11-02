// How many issues a workspace can hold before the relay stops saving it.
//
// ADR 0010 states this as a measured range, and the number is load-bearing: it is the basis for
// "do not raise the ceiling" and for the banner existing at all. Nothing asserted it, so a
// single new field on the issue model could move the real capacity by thousands of issues while
// the ADR went on quoting the old figure — and nobody would find out until a demo workspace
// quietly stopped persisting.
//
// The threshold is read out of the relay's source as TEXT rather than imported. Importing it
// would pull workerd's types into the app's program (the relay's `storage.ts` is typed against
// `SqlStorage`), and duplicating the number here would be the same drift this file exists to
// prevent. `?raw` costs neither: a rename fails this test loudly, which is the point.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import storageSource from '../../../workers/relay/src/storage.ts?raw';
import { createDoc, getIssuesMap } from './doc.js';
import { seedIssues } from './seed.js';

/** The relay's own ceiling, read from its source so a rename or a retune fails here. */
function relayConstant(name: string): number {
	const match = storageSource.match(new RegExp(`export const ${name} = ([0-9_]+)`));
	if (!match) {
		throw new Error(
			`workers/relay/src/storage.ts no longer exports a numeric ${name}. If the snapshot ` +
				`guard was reshaped, this capacity test needs to be pointed at whatever replaced it.`
		);
	}
	return Number(match[1]!.replace(/_/g, ''));
}

/** Encoded size of a workspace holding `count` generated issues, as the relay would store it. */
function encodedBytes(count: number): number {
	const doc = createDoc();
	// Pinned: the random id is encoded as a varint in each item's origin, and one below 2^28 is a
	// byte shorter, about 9 bytes per issue. That was 1 run in 16 falling out of the band below.
	doc.clientID = 2 ** 30;
	try {
		// Fixed seed: this is a measurement, and a measurement that moves on its own is useless.
		seedIssues(getIssuesMap(doc), count, { seed: 1 });
		return Y.encodeStateAsUpdate(doc).byteLength;
	} finally {
		doc.destroy();
	}
}

const MAX_BYTES = relayConstant('SNAPSHOT_MAX_BYTES');
const WARN_BYTES = relayConstant('SNAPSHOT_WARN_BYTES');

describe('snapshot capacity', () => {
	it('costs 307.6 bytes per issue, within one field of drift', () => {
		// Deliberately tight, and the width is measured rather than guessed: at 4,000 issues the
		// figure is 307.644, and adding one field to the generated issue costs about 22 bytes
		// (measured: an integer +21.96, a timestamp +25.96). A band of 300–320 therefore fails
		// if a field is added OR removed, which is the only drift that can silently move the
		// capacity ADR 0010 quotes. A first attempt at this test used 280–345 and caught
		// neither — it is worth knowing that a loose band here looks identical to a tight one
		// until something actually changes.
		//
		// Yjs encodes deterministically for identical input and a pinned clientID, so there is no noise to absorb;
		// a failure here means the input changed, or the library's encoding did. Either way the
		// right response is to re-measure and update ADR 0010, not to widen the band.
		const perIssue = encodedBytes(4000) / 4000;
		expect(perIssue).toBeGreaterThan(300);
		expect(perIssue).toBeLessThan(320);
	});

	it('still saves a 4,000-issue workspace, below even the warning threshold', () => {
		// The healthy case, and the reason the warning exists: there has to be a size that is
		// large by any demo standard and still nowhere near refusal.
		expect(encodedBytes(4000)).toBeLessThan(WARN_BYTES);
	});

	it('refuses an 8,000-issue workspace', () => {
		// The case the banner is for. 8,000 rather than the 6,000 an earlier audit suggested:
		// 6,000 encodes to ~1.86 MB, which is 2.3% under the ceiling — close enough that
		// ordinary encoding variation, not a regression, would decide whether the test passed.
		expect(encodedBytes(8000)).toBeGreaterThan(MAX_BYTES);
	});

	it('crosses the ceiling in the range ADR 0010 documents', () => {
		// The ADR's own claim, asserted: ~6,100 issues of this shape. Bounded on both sides so
		// the test fails whether capacity grows or shrinks — a capacity that silently doubled
		// would make the banner unreachable in practice and the ADR's reasoning obsolete.
		const crossover = MAX_BYTES / (encodedBytes(6000) / 6000);
		expect(crossover).toBeGreaterThan(5500);
		expect(crossover).toBeLessThan(7000);
	});
});
