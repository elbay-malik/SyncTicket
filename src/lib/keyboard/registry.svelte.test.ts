// Runs in the browser project because the registry holds runes state, and because the
// guards are about real DOM targets — the thing that went wrong repeatedly in earlier
// phases was a shortcut firing from inside a menu or a text field.

import { describe, expect, it, vi } from 'vitest';
import { ShortcutRegistry } from './registry.svelte.js';

function press(
	key: string,
	options: Partial<KeyboardEventInit> & { target?: Element } = {}
): KeyboardEvent {
	const { target, ...init } = options;
	const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init });
	if (target) Object.defineProperty(event, 'target', { value: target });
	return event;
}

function inside(html: string): Element {
	const host = document.createElement('div');
	host.innerHTML = html;
	document.body.appendChild(host);
	return host.firstElementChild as Element;
}

describe('ShortcutRegistry', () => {
	it('runs a matching shortcut and prevents the default', () => {
		const registry = new ShortcutRegistry();
		const run = vi.fn();
		registry.register({ id: 'new', chord: 'c', label: 'New issue', group: 'Issues', run });

		const event = press('c');
		expect(registry.handle(event)).toBe(true);
		expect(run).toHaveBeenCalledOnce();
		expect(event.defaultPrevented).toBe(true);
	});

	it('unregisters cleanly, and a re-register under the same id survives the old cleanup', () => {
		const registry = new ShortcutRegistry();
		const first = vi.fn();
		const second = vi.fn();
		const off = registry.register({
			id: 'x',
			chord: 'c',
			label: 'One',
			group: 'Issues',
			run: first
		});
		registry.register({ id: 'x', chord: 'c', label: 'Two', group: 'Issues', run: second });

		// The stale cleanup from the first registration must not remove the replacement.
		off();
		expect(registry.handle(press('c'))).toBe(true);
		expect(second).toHaveBeenCalledOnce();
		expect(first).not.toHaveBeenCalled();
	});

	it('ignores repeats, composition and already-handled events', () => {
		const registry = new ShortcutRegistry();
		const run = vi.fn();
		registry.register({ id: 'new', chord: 'c', label: 'New', group: 'Issues', run });

		expect(registry.handle(press('c', { repeat: true }))).toBe(false);
		expect(registry.handle(press('c', { isComposing: true }))).toBe(false);
		const handled = press('c');
		handled.preventDefault();
		expect(registry.handle(handled)).toBe(false);
		expect(run).not.toHaveBeenCalled();
	});

	it('does not fire a bare letter while the user is typing', () => {
		const registry = new ShortcutRegistry();
		const run = vi.fn();
		registry.register({ id: 'new', chord: 'c', label: 'New', group: 'Issues', run });

		for (const html of [
			'<input />',
			'<textarea></textarea>',
			'<div contenteditable="true"><span>x</span></div>'
		]) {
			const target = inside(html);
			const inner = target.querySelector('span') ?? target;
			expect(registry.handle(press('c', { target: inner }))).toBe(false);
		}
		expect(run).not.toHaveBeenCalled();
	});

	it('fires in a text field only when the shortcut opts in', () => {
		const registry = new ShortcutRegistry();
		const run = vi.fn();
		registry.register({
			id: 'palette',
			chord: 'mod+k',
			label: 'Command palette',
			group: 'Navigation',
			allowInInput: true,
			allowInOverlay: true,
			run
		});
		registry.setApple(true);

		const target = inside('<input />');
		expect(registry.handle(press('k', { metaKey: true, target }))).toBe(true);
		expect(run).toHaveBeenCalledOnce();
	});

	it('does not fire inside a menu, where printable keys drive type-ahead', () => {
		const registry = new ShortcutRegistry();
		const run = vi.fn();
		registry.register({ id: 'new', chord: 'c', label: 'New', group: 'Issues', run });

		const target = inside('<div role="menu"><div role="menuitem">Canceled</div></div>');
		const item = target.querySelector('[role="menuitem"]')!;
		expect(registry.handle(press('c', { target: item }))).toBe(false);
		expect(run).not.toHaveBeenCalled();
	});

	it('respects the platform when deciding what mod means', () => {
		const registry = new ShortcutRegistry();
		const run = vi.fn();
		registry.register({
			id: 'palette',
			chord: 'mod+k',
			label: 'Palette',
			group: 'Navigation',
			allowInInput: true,
			run
		});

		expect(registry.handle(press('k', { ctrlKey: true }))).toBe(true);
		registry.setApple(true);
		expect(registry.handle(press('k', { ctrlKey: true }))).toBe(false);
		expect(registry.handle(press('k', { metaKey: true }))).toBe(true);
	});

	it('exposes display hints that follow the platform', () => {
		const registry = new ShortcutRegistry();
		registry.register({
			id: 'palette',
			chord: 'mod+k',
			label: 'Palette',
			group: 'Navigation',
			run: () => {}
		});
		expect(registry.hint('palette')).toBe('Ctrl+K');
		registry.setApple(true);
		expect(registry.hint('palette')).toBe('⌘K');
		expect(registry.hint('nope')).toBe('');
	});

	it('hides cursor keys from the listing but still dispatches them', () => {
		const registry = new ShortcutRegistry();
		const run = vi.fn();
		registry.register({
			id: 'down',
			chord: 'j',
			label: 'Next',
			group: 'Issues',
			hidden: true,
			run
		});
		registry.register({ id: 'new', chord: 'c', label: 'New', group: 'Issues', run: () => {} });

		expect(registry.listed.map((s) => s.id)).toEqual(['new']);
		expect(registry.all.map((s) => s.id)).toEqual(['down', 'new']);
		expect(registry.handle(press('j'))).toBe(true);
		expect(run).toHaveBeenCalledOnce();
	});
});
