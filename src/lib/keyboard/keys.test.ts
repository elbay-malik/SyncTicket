import { describe, expect, it } from 'vitest';
import {
	formatChord,
	isApple,
	isInOverlay,
	isTypingTarget,
	matchesChord,
	parseChord
} from './keys.js';

/** A KeyboardEvent stand-in; Node has no DOM but matchesChord only reads these fields. */
function key(
	k: string,
	mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {}
): KeyboardEvent {
	return {
		key: k,
		ctrlKey: mods.ctrl ?? false,
		metaKey: mods.meta ?? false,
		shiftKey: mods.shift ?? false,
		altKey: mods.alt ?? false
	} as KeyboardEvent;
}

describe('parseChord', () => {
	it('parses a bare key and modifiers', () => {
		expect(parseChord('c')).toEqual({ key: 'c', mod: false, shift: false, alt: false });
		expect(parseChord('mod+k')).toEqual({ key: 'k', mod: true, shift: false, alt: false });
		expect(parseChord('shift+/')).toEqual({ key: '/', mod: false, shift: true, alt: false });
		expect(parseChord('mod+shift+p')).toEqual({ key: 'p', mod: true, shift: true, alt: false });
	});

	it('is case- and whitespace-insensitive', () => {
		expect(parseChord(' MOD + K ')).toEqual(parseChord('mod+k'));
	});

	it('rejects nonsense', () => {
		expect(() => parseChord('')).toThrow();
		expect(() => parseChord('hyper+k')).toThrow(/hyper/);
	});
});

describe('matchesChord', () => {
	it('requires modifiers to match exactly, not merely be present', () => {
		// The bug this prevents: a bare "c" shortcut firing on every ⌘C copy.
		const c = parseChord('c');
		expect(matchesChord(key('c'), c, true)).toBe(true);
		expect(matchesChord(key('c', { meta: true }), c, true)).toBe(false);
		expect(matchesChord(key('c', { ctrl: true }), c, false)).toBe(false);
		expect(matchesChord(key('c', { alt: true }), c, true)).toBe(false);
		expect(matchesChord(key('c', { shift: true }), c, true)).toBe(false);
	});

	it('maps mod to Command on Apple and Control elsewhere', () => {
		const modK = parseChord('mod+k');
		expect(matchesChord(key('k', { meta: true }), modK, true)).toBe(true);
		expect(matchesChord(key('k', { ctrl: true }), modK, true)).toBe(false);
		expect(matchesChord(key('k', { ctrl: true }), modK, false)).toBe(true);
		expect(matchesChord(key('k', { meta: true }), modK, false)).toBe(false);
	});

	it('compares the key case-insensitively, since Shift changes event.key', () => {
		const shiftJ = parseChord('shift+j');
		expect(matchesChord(key('J', { shift: true }), shiftJ, true)).toBe(true);
	});

	it('matches punctuation by the character produced, whatever the layout', () => {
		// "?" is Shift+/ on a US keyboard and unshifted on some others. Chords name the
		// character, and the shift state is ignored for punctuation so both layouts work.
		const help = parseChord('?');
		expect(matchesChord(key('?', { shift: true }), help, true)).toBe(true);
		expect(matchesChord(key('?'), help, true)).toBe(true);
		// Modifiers other than Shift are still exact, so ⌘? does not trigger it.
		expect(matchesChord(key('?', { meta: true }), help, true)).toBe(false);
	});

	it('matches named keys', () => {
		expect(matchesChord(key('ArrowDown'), parseChord('arrowdown'), true)).toBe(true);
		expect(matchesChord(key('Escape'), parseChord('escape'), false)).toBe(true);
	});
});

describe('formatChord', () => {
	it('uses platform symbols', () => {
		expect(formatChord(parseChord('mod+k'), true)).toBe('⌘K');
		expect(formatChord(parseChord('mod+k'), false)).toBe('Ctrl+K');
	});

	it('leaves punctuation as the character it produces', () => {
		expect(formatChord(parseChord('?'), true)).toBe('?');
		expect(formatChord(parseChord('shift+j'), true)).toBe('⇧J');
		expect(formatChord(parseChord('shift+j'), false)).toBe('Shift+J');
	});

	it('names arrows and other non-printing keys', () => {
		expect(formatChord(parseChord('arrowdown'), true)).toBe('↓');
		expect(formatChord(parseChord('escape'), false)).toBe('Esc');
		expect(formatChord(parseChord('c'), true)).toBe('C');
	});
});

describe('isApple', () => {
	it('recognises Apple platforms and nothing else', () => {
		expect(isApple('MacIntel')).toBe(true);
		expect(isApple('iPhone')).toBe(true);
		expect(isApple('macOS')).toBe(true);
		expect(isApple('Win32')).toBe(false);
		expect(isApple('Linux x86_64')).toBe(false);
		expect(isApple(undefined)).toBe(false);
	});
});

describe('guards', () => {
	/** Minimal Element stand-in: both guards only ever call closest(). */
	function element(matches: string[]): EventTarget {
		const el = {
			closest: (selector: string) =>
				matches.some((m) => selector.includes(m)) ? (el as unknown as Element) : null
		};
		return el as unknown as EventTarget;
	}

	it('treats no target and non-elements as safe', () => {
		expect(isTypingTarget(null)).toBe(false);
		expect(isInOverlay(null)).toBe(false);
	});

	it('detects text entry', () => {
		expect(isTypingTarget(element(['input']))).toBe(true);
		expect(isTypingTarget(element(['textarea']))).toBe(true);
		expect(isTypingTarget(element(['contenteditable']))).toBe(true);
		expect(isTypingTarget(element(['button']))).toBe(false);
	});

	it('detects overlays that own the keyboard', () => {
		expect(isInOverlay(element(['[role="dialog"]']))).toBe(true);
		expect(isInOverlay(element(['[role="menu"]']))).toBe(true);
		expect(isInOverlay(element(['[role="listbox"]']))).toBe(true);
		expect(isInOverlay(element(['button']))).toBe(false);
	});
});
