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

/** Every .svelte file under `dir`, recursively — by default the owned shadcn directory. */
function primitives(dir = UI): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return primitives(path);
		return entry.isFile() && entry.name.endsWith('.svelte') ? [path] : [];
	});
}

/** App components and routes: everything that is not a primitive. */
function appFiles(): string[] {
	return [...primitives('src/lib/components'), ...primitives('src/routes')].filter(
		(path) => !path.startsWith(UI + '/')
	);
}

/**
 * Opening tags of the elements that are focusable and styled in place: a raw `<button>`, or a
 * bits-ui `<X.Trigger>` carrying its own `class`. A Trigger that delegates through `child` to
 * Button inherits Button's ring and has no `class` of its own, so it is not collected.
 *
 * Walked rather than regex-matched, because an attribute like `onclick={() => x}` holds a `>`
 * that would end a naive `[^>]*` early and hide the class that follows it.
 */
function styledFocusables(source: string): string[] {
	const tags: string[] = [];
	for (const match of source.matchAll(/<(?:button|[A-Z]\w*\.Trigger)\b/g)) {
		let depth = 0;
		let quote = '';
		let end = match.index;
		for (; end < source.length; end++) {
			const char = source[end];
			if (quote) {
				if (char === quote) quote = '';
			} else if (char === '"' || char === "'") quote = char;
			else if (char === '{') depth++;
			else if (char === '}') depth--;
			else if (char === '>' && depth === 0) break;
		}
		const tag = source.slice(match.index, end + 1);
		if (/\sclass=/.test(tag)) tags.push(tag);
	}
	return tags;
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

	it('rings every hand-styled button and trigger outside the primitives too', () => {
		// The scans above only see `ui/`. The relay-status trigger is a bits-ui Popover.Trigger
		// styled in place in the header — not through Button — and it shipped on the browser's
		// default 1px auto outline, the one control in the app without the 2px ring. Anything
		// that opts out of Button's classes has to restate the ring, so this collects exactly
		// those elements and checks each one draws it.
		const tags = appFiles().flatMap((path) =>
			styledFocusables(code(path)).map((tag) => ({ path, tag }))
		);
		// Non-vacuity: the trigger this was written for must be among what the scan collects.
		expect(tags.some(({ path }) => path.endsWith('shell/relay-status.svelte'))).toBe(true);

		const offenders = tags
			.filter(
				({ tag }) =>
					!/focus-visible:ring-2\b/.test(tag) ||
					!/focus-visible:ring-ring\b/.test(tag) ||
					!/\boutline-none\b/.test(tag)
			)
			.map(({ path }) => path);
		expect(offenders).toEqual([]);
	});
});
