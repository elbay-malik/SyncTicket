// In-flow surfaces carry no shadow.
//
// DESIGN.md's Depth Means Floating Rule: a shadow means the surface is genuinely floating, and
// a shadow on a card, row, column or panel is a defect. The board card carried a resting
// `shadow-xs` for long enough that DESIGN.md had to record it as "known deviation" — the rule
// was written down and still not held, because nothing read the class string. This does.
//
// Scanned from source, like focus-ring.test.ts, so the string is caught the moment it returns.
// Only the in-flow surfaces are named: the floating remote notice in issue-list.svelte is
// meant to carry `shadow-md`, and a blanket scan would have to learn which is which.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const IN_FLOW = [
	'src/lib/components/issues/board-column.svelte',
	'src/lib/components/issues/issue-row.svelte'
];

/** Any Tailwind shadow utility other than the deliberate `shadow-none`. */
const SHADOW = /(?<![\w-])shadow(?:-(?!none\b)[\w[\]/.-]+)?(?![\w-])/g;

/** Class strings only: comments explain the rule and may name the utility they forbid. */
function classText(source: string): string {
	return [...source.replace(/<!--[\s\S]*?-->/g, '').matchAll(/class(?::\w+)?="([^"]*)"/g)]
		.map((match) => match[1])
		.join(' ');
}

describe('in-flow surfaces', () => {
	it('finds the class strings it is checking', () => {
		// Vacuity guard: a markup change that this parser stopped reading would pass silently.
		// Both surfaces are `relative isolate` hosts for the remote trace, so that is the anchor.
		for (const file of IN_FLOW) {
			expect(classText(readFileSync(file, 'utf8')), file).toMatch(/\brelative isolate\b/);
		}
	});

	it.each(IN_FLOW)('%s draws no shadow', (file) => {
		expect(classText(readFileSync(file, 'utf8')).match(SHADOW) ?? []).toEqual([]);
	});
});
