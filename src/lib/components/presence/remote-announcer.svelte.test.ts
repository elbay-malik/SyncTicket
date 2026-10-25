// The live region that tells assistive technology what peers just changed. Timing rules
// (settle, gap, quiet, repeat) are proven with fake timers in remote-change.test.ts; this proves the
// region itself: present and empty before anything happens, polite, and saying the sentence.

import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { RemoteActivity } from '$lib/state/remote-activity.svelte.js';
import type { RemoteChange } from '$lib/state/remote-change.js';
import RemoteAnnouncer from './remote-announcer.svelte';

const activities: RemoteActivity[] = [];

afterEach(() => {
	while (activities.length) activities.pop()?.destroy();
});

const ada = { userId: `u${'a'.repeat(32)}`, name: 'Ada Lovelace', hue: 210 };

function arrival(issueId: string, patch: Partial<RemoteChange> = {}): RemoteChange {
	return {
		issueId,
		kind: 'status',
		title: 'Fix login redirect',
		status: 'done',
		author: ada,
		at: Date.now(),
		...patch
	};
}

async function mount() {
	const activity = new RemoteActivity();
	activities.push(activity);
	const { container } = await render(RemoteAnnouncer, { activity });
	const region = container.querySelector<HTMLElement>('[data-testid="remote-announcer"]');
	return { activity, region: region as HTMLElement };
}

describe('remote-announcer.svelte', () => {
	it('is a polite region that exists, empty, before its first message', async () => {
		const { region } = await mount();
		expect(region.getAttribute('role')).toBe('status');
		expect(region.getAttribute('aria-live')).toBe('polite');
		expect(region.getAttribute('aria-atomic')).toBe('true');
		expect(region.textContent?.trim()).toBe('');
	});

	it('says who moved which issue where', async () => {
		const { activity, region } = await mount();
		activity.record(arrival('i1'));
		await expect
			.poll(() => region.textContent?.trim())
			.toBe('Ada Lovelace moved “Fix login redirect” to Done');
	});

	it('says a burst as one sentence', async () => {
		const { activity, region } = await mount();
		activity.record(arrival('i1'));
		activity.record(arrival('i2', { kind: 'created' }));
		activity.record(arrival('i3', { kind: 'deleted' }));
		await expect.poll(() => region.textContent?.trim()).toBe('Ada Lovelace changed 3 issues');
	});

	it('says an edit once its author stops, with the title it ended on', async () => {
		const { activity, region } = await mount();
		// Two idle commits of one typing run: the half-word must never be the one said.
		activity.record(arrival('i1', { kind: 'edited', title: 'Fix lo' }));
		activity.record(arrival('i1', { kind: 'edited', title: 'Fix login' }));
		await expect
			.poll(() => region.textContent?.trim(), { timeout: 3000 })
			.toBe('Ada Lovelace edited “Fix login”');
	});
});
