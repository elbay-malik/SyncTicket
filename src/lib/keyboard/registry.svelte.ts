// The one place shortcuts are declared and dispatched.
//
// Before this, each shortcut carried its own copy of the guard list, and they drifted: the
// "c" handler in the root layout knew about menu type-ahead and IME composition, while the
// palette's ⌘K handler knew about neither. A registry means the rules are written once, and
// the palette and the help sheet can show what actually exists rather than a hand-kept list.

import { SvelteMap } from 'svelte/reactivity';
import {
	formatChord,
	isInOverlay,
	isTypingTarget,
	matchesChord,
	parseChord,
	type Chord
} from './keys.js';

export type ShortcutGroup = 'Issues' | 'Navigation' | 'View';

export interface Shortcut {
	id: string;
	/** A chord spec, e.g. `mod+k` or `c`. See parseChord. */
	chord: string;
	label: string;
	group: ShortcutGroup;
	run: () => void;
	/** Fire even while the user is typing. Only for chords with a modifier. */
	allowInInput?: boolean;
	/** Fire even inside a dialog, menu or listbox. */
	allowInOverlay?: boolean;
	/** Keep out of the palette and help sheet. */
	hidden?: boolean;
}

export interface ListedShortcut extends Shortcut {
	/** Ready to display, e.g. "⌘K" or "Ctrl+K". */
	hint: string;
}

interface Entry extends Shortcut {
	parsed: Chord;
}

export class ShortcutRegistry {
	#byId = new SvelteMap<string, Entry>();
	/** Set while another widget owns the keyboard, e.g. a drag in progress on the board. */
	#suspended = $state(false);
	/** Whether `mod` means Command. Stays false until the browser tells us (see setApple). */
	#apple = $state(false);

	/**
	 * Set once on mount. It deliberately starts false so the server and the first client
	 * render agree — a platform-dependent hint rendered during hydration would mismatch.
	 */
	setApple(apple: boolean): void {
		this.#apple = apple;
	}

	get apple(): boolean {
		return this.#apple;
	}

	/**
	 * Silences every shortcut while another widget owns the keyboard.
	 *
	 * The board's keyboard drag is the case that needs it: mid-drag the user presses arrows
	 * and Tab, and a stray `c` or `b` would open a dialog or navigate away leaving the drag
	 * stranded with a card picked up and no way to put it down.
	 */
	setSuspended(suspended: boolean): void {
		this.#suspended = suspended;
	}

	get suspended(): boolean {
		return this.#suspended;
	}

	/** Registers a shortcut and returns the function that removes it again. */
	register(shortcut: Shortcut): () => void {
		const entry: Entry = { ...shortcut, parsed: parseChord(shortcut.chord) };
		this.#byId.set(shortcut.id, entry);
		return () => {
			// Only remove our own entry: a re-register under the same id (hot reload, or a
			// component remounting) must not be undone by the previous instance's cleanup.
			if (this.#byId.get(shortcut.id) === entry) this.#byId.delete(shortcut.id);
		};
	}

	/** Everything registered, in registration order, with display-ready hints. */
	get all(): ListedShortcut[] {
		return [...this.#byId.values()].map((entry) => ({
			...entry,
			hint: formatChord(entry.parsed, this.#apple)
		}));
	}

	/** Shortcuts worth showing in the palette and the help sheet. */
	get listed(): ListedShortcut[] {
		return this.all.filter((shortcut) => !shortcut.hidden);
	}

	/** Returns the display hint for one id, or '' if it is not registered. */
	hint(id: string): string {
		const entry = this.#byId.get(id);
		return entry ? formatChord(entry.parsed, this.#apple) : '';
	}

	/**
	 * Runs the first shortcut matching `event`, and reports whether one ran.
	 *
	 * `repeat` is excluded so holding a key does not fire a command dozens of times, and
	 * `isComposing` because an IME emits keydown for characters the user is still composing.
	 */
	handle(event: KeyboardEvent): boolean {
		if (this.#suspended) return false;
		if (event.defaultPrevented || event.repeat || event.isComposing) return false;
		const typing = isTypingTarget(event.target);
		const overlay = isInOverlay(event.target);
		for (const entry of this.#byId.values()) {
			if (!matchesChord(event, entry.parsed, this.#apple)) continue;
			if (typing && !entry.allowInInput) continue;
			if (overlay && !entry.allowInOverlay) continue;
			event.preventDefault();
			entry.run();
			return true;
		}
		return false;
	}
}

/**
 * The app-wide registry. A module singleton like `issueUi`: registration only ever happens
 * from the browser (onMount and effect cleanups), so nothing leaks between SSR requests.
 */
export const shortcuts = new ShortcutRegistry();
