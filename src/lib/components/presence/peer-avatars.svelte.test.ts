// peer-avatars keys its {#each} on `peer.userId`, which every client declares for itself, so this
// is the same each_key_duplicate that a repeated label threw. It cannot reach the block, because
// Presence folds `peers` per user id and `everyone` folds this browser's own id into `me`. These
// pin that with real awareness messages, through the header that renders them.

import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createIdentity } from '$lib/model/identity.js';
import { Presence } from '$lib/state/presence.svelte.js';
import PeerAvatars from './peer-avatars.svelte';
import PresenceBar from './presence-bar.svelte';

const SHARED = `u${'a'.repeat(32)}`;

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length) cleanups.pop()?.();
});

function makeAwareness(): Awareness {
	const awareness = new Awareness(new Y.Doc());
	clearInterval(awareness._checkInterval);
	cleanups.push(() => awareness.destroy());
	return awareness;
}

async function makeRoom() {
	const awareness = makeAwareness();
	const presence = new Presence(awareness, { ...createIdentity(), name: 'Me Myself' });
	cleanups.push(() => presence.destroy());
	const { container } = await render(PresenceBar, { presence });
	/** A separate client saying `state`, delivered the way the relay forwards it. */
	const announce = (state: Record<string, unknown>) => {
		const peer = makeAwareness();
		peer.setLocalState(state);
		applyAwarenessUpdate(awareness, encodeAwarenessUpdate(peer, [peer.clientID]), 'relay');
	};
	const avatars = async () => {
		await new Promise((resolve) => requestAnimationFrame(resolve));
		return [...container.querySelectorAll<HTMLElement>('[data-peer]')].map((el) => el.dataset.peer);
	};
	return { presence, announce, avatars };
}

describe('a user id several clients declare', () => {
	it('is one avatar when it is well formed', async () => {
		const { presence, announce, avatars } = await makeRoom();
		announce({ userId: SHARED, name: 'Ada Lovelace', hue: 210, issue: null, t: 1 });
		announce({ userId: SHARED, name: 'Ada Again', hue: 12, issue: null, t: 2 });

		expect(await avatars()).toHaveLength(2);
		expect(presence.peers.map((peer) => peer.sessions)).toEqual([2]);
	});

	it('is one avatar when it is a string that is no id', async () => {
		const { presence, announce, avatars } = await makeRoom();
		announce({ userId: 'not-an-id', name: 'Ada Lovelace' });
		announce({ userId: 'not-an-id', name: 'Ada Lovelace' });

		expect(await avatars()).toHaveLength(2);
		expect(presence.peers).toHaveLength(1);
	});

	it('is one avatar when it is copied from this browser', async () => {
		const { presence, announce, avatars } = await makeRoom();
		announce({ userId: presence.me.userId, name: 'Impostor' });
		announce({ userId: presence.me.userId, name: 'Impostor' });

		expect(await avatars()).toEqual(['Me Myself']);
		expect(presence.myOtherTabs).toBe(2);
	});

	it('is one avatar on the issue both clients have open', async () => {
		const { presence, announce } = await makeRoom();
		const issue = crypto.randomUUID();
		announce({ userId: SHARED, name: 'Ada Lovelace', issue });
		announce({ userId: SHARED, name: 'Ada Lovelace', issue });
		const { container } = await render(PeerAvatars, { peers: presence.viewersOf(issue) });

		expect(container.querySelectorAll('[data-peer]')).toHaveLength(1);
	});
});

describe('a value that is not a usable string', () => {
	it.each([
		{ name: 'a number for the user id', state: { userId: 42, name: 'Ada' } },
		{ name: 'null for the user id', state: { userId: null, name: 'Ada' } },
		{ name: 'an object for the user id', state: { userId: { a: 1 }, name: 'Ada' } },
		{ name: 'no user id', state: { name: 'Ada' } },
		{ name: 'a number for the name', state: { userId: SHARED, name: 42 } },
		{ name: 'an array for the name', state: { userId: SHARED, name: ['Ada'] } },
		{ name: 'no name', state: { userId: SHARED } }
	])('is dropped: $name', async ({ state }) => {
		const { presence, announce, avatars } = await makeRoom();
		announce(state);

		expect(presence.peers).toEqual([]);
		expect(await avatars()).toEqual(['Me Myself']);
	});

	it('repairs a name that cleans to nothing, and a hue that is no hue, rather than crash', async () => {
		const { presence, announce, avatars } = await makeRoom();
		announce({ userId: SHARED, name: '‮​', hue: 'red' });

		const [peer] = presence.peers;
		expect(peer?.name).not.toBe('');
		expect(typeof peer?.hue).toBe('number');
		expect(await avatars()).toHaveLength(2);
	});
});
