// Every focusable primitive rings with the solid token, at 2px.
//
// This exists because the rule it enforces was written down, explained in a code comment, and
// then violated three files away. DESIGN.md says: "Don't soften the focus ring to a translucent
// blend. At this token a /50 ring measures 2.32:1 against the background versus 7.44:1 solid,
// so the blend cannot clear 3:1." `button.svelte` was corrected and carries that reasoning;
// `input`, `textarea`, `input-group` and `badge` kept shadcn's stock `ring-ring/50` at `ring-3`,
// and a browser measurement of the shipped quick-add field read 2.32:1 in light and 2.34:1 in
// dark — under WCAG 1.4.11's 3:1, on the first control a visitor touches.
//
// The failure mode is specific and will recur: `shadcn-svelte add <component>` rewrites these
// files from upstream, and upstream ships the blend. A reviewer cannot be expected to notice a
// re-added `/50` inside a 600-character class string. This test is what notices.
//
// Scanned from source rather than from a rendered component because the point is to catch the
// string the moment it returns, including in a primitive this app does not currently render.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const UI = 'src/lib/components/ui';

/** Every .svelte file under the owned shadcn directory. */
function primitives(dir = UI): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return primitives(path);
		return entry.isFile() && entry.name.endsWith('.svelte') ? [path] : [];
	});
}

/** Source with `//` comment lines removed, so the button's own prose cannot match. */
function code(path: string): string {
	return readFileSync(path, 'utf8')
		.split('\n')
		.filter((line) => !line.trim().startsWith('//'))
		.join('\n');
}

describe('focus rings', () => {
	it('finds the primitives at all', () => {
		// A glob that silently matches nothing would make every assertion below vacuous.
		const files = primitives();
		expect(files.length).toBeGreaterThan(20);
		expect(files.some((f) => f.endsWith('button.svelte'))).toBe(true);
	});

	it('never softens a focus ring to a translucent blend', () => {
		const offenders = primitives().filter((path) =>
			/focus-visible\]?:ring-ring\/\d+/.test(code(path))
		);
		expect(offenders).toEqual([]);
	});

	it('draws focus rings at 2px, not shadcn-s 3px', () => {
		// 3px is stock. It is not a contrast failure on its own, but "focus looks identical on
		// every control" is the other half of the same rule, and the blend arrives with it.
		const offenders = primitives().filter((path) =>
			/focus-visible\]?:ring-(?:3|\[3px\])\b/.test(code(path))
		);
		expect(offenders).toEqual([]);
	});
});
