// Chord parsing, matching and formatting. No Svelte, no DOM ownership — just decisions
// about a KeyboardEvent, so it can be unit-tested in Node.
//
// This is also where the guards that caused bugs in Phases 4 and 5 finally live once. A
// document-level single-letter shortcut is a surprisingly hostile thing to get right: menus
// run type-ahead on printable keys, text fields eat them, IME composition emits them, and
// holding a key repeats them.

/** A single key plus its modifiers. `mod` is Command on Apple platforms, Control elsewhere. */
export interface Chord {
	key: string;
	mod: boolean;
	shift: boolean;
	alt: boolean;
}

/**
 * Parses a spec like `mod+k`, `shift+/` or `c`. Sequences ("g then i") are deliberately
 * unsupported: they need a pending-chord state machine, and nothing here needs one.
 */
export function parseChord(spec: string): Chord {
	const parts = spec
		.split('+')
		.map((part) => part.trim().toLowerCase())
		.filter(Boolean);
	const key = parts.pop();
	if (!key) throw new Error(`invalid chord: "${spec}"`);
	const chord: Chord = { key, mod: false, shift: false, alt: false };
	for (const part of parts) {
		if (part === 'mod') chord.mod = true;
		else if (part === 'shift') chord.shift = true;
		else if (part === 'alt') chord.alt = true;
		else throw new Error(`unknown modifier "${part}" in chord "${spec}"`);
	}
	return chord;
}

/** True on Apple platforms, where `mod` means Command rather than Control. */
export function isApple(platform: string | undefined): boolean {
	return /mac|iphone|ipad|ipod/i.test(platform ?? '');
}

/** A printable character that is not a letter, e.g. "?" or "/". */
function isPunctuation(key: string): boolean {
	return key.length === 1 && !/[a-z0-9]/i.test(key);
}

/**
 * Whether `event` is exactly this chord.
 *
 * Modifiers must match exactly rather than merely be present: without that, a bare `c`
 * shortcut would also fire on every ⌘C. Chords match the character the browser *produces*
 * (`event.key`), so they follow the user's layout rather than assuming a US keyboard.
 *
 * Shift is the exception. For punctuation the produced character already encodes it — "?"
 * is Shift+/ on a US layout and unshifted elsewhere — so requiring a particular shift state
 * would make the shortcut work on some keyboards and not others.
 */
export function matchesChord(event: KeyboardEvent, chord: Chord, apple: boolean): boolean {
	const wantsCtrl = chord.mod && !apple;
	const wantsMeta = chord.mod && apple;
	if (event.ctrlKey !== wantsCtrl) return false;
	if (event.metaKey !== wantsMeta) return false;
	if (event.altKey !== chord.alt) return false;
	if (!isPunctuation(chord.key) && event.shiftKey !== chord.shift) return false;
	return event.key.toLowerCase() === chord.key;
}

const MOD_SYMBOL = { apple: '⌘', other: 'Ctrl' } as const;

const KEY_LABELS: Record<string, string> = {
	arrowup: '↑',
	arrowdown: '↓',
	arrowleft: '←',
	arrowright: '→',
	enter: '↵',
	escape: 'Esc',
	' ': 'Space'
};

/** Human-readable form for a shortcut hint, e.g. "⌘K", "Ctrl+K", "?" or "J". */
export function formatChord(chord: Chord, apple: boolean): string {
	const parts: string[] = [];
	if (chord.mod) parts.push(apple ? MOD_SYMBOL.apple : MOD_SYMBOL.other);
	if (chord.alt) parts.push(apple ? '⌥' : 'Alt');
	// A shifted punctuation key already reads as its shifted form ("?"), so only say "Shift"
	// when the key is a letter, where it would otherwise be invisible.
	if (chord.shift && /^[a-z]$/.test(chord.key)) parts.push(apple ? '⇧' : 'Shift');
	const label =
		KEY_LABELS[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
	parts.push(label);
	return apple ? parts.join('') : parts.join('+');
}

const TYPING_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** Duck-typed rather than `instanceof Element`: this module is unit-tested in Node, and
 * the check also survives elements from another realm, where `instanceof` quietly fails. */
function closest(target: EventTarget | null, selector: string): boolean {
	const candidate = target as { closest?: (s: string) => unknown } | null;
	return typeof candidate?.closest === 'function' && candidate.closest(selector) !== null;
}

/** True when the user is typing, so a bare letter belongs to them and not to a shortcut. */
export function isTypingTarget(target: EventTarget | null): boolean {
	return closest(target, TYPING_SELECTOR);
}

const OVERLAY_SELECTOR =
	'[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="combobox"]';

/**
 * True when focus sits inside an overlay that owns the keyboard: menus type-ahead on
 * printable keys without preventing default, and a dialog's own controls must not summon
 * another dialog behind it.
 */
export function isInOverlay(target: EventTarget | null): boolean {
	return closest(target, OVERLAY_SELECTOR);
}
