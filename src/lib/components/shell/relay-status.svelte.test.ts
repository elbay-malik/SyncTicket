// Whether this component surfaces the third sentence, and swaps the icon, when the relay has
// stopped saving the workspace.
//
// `connectionCopy` decides the wording and `src/lib/format.test.ts` covers it exhaustively;
// none of that proves this component renders the sentence it is handed. The gap matters because
// the durability banner was the one part of ADR 0010 nobody had seen fire: the planner, the
// classifier, the notice encoding and the copy are each unit-tested, and the path from "the
// relay refused to save" to "a person can read why" was checked by hand, once.
//
// Two decisions here are deliberate and counter-intuitive enough to be worth pinning:
//
//   - A healthy workspace gets NO third row. Not an empty one, not a reassuring one — the
//     popover must not train people to stop reading it.
//   - A failing relay takes the icon from the connection state, even though `connection` is
//     literally 'connected' and the socket is fine. An icon that says "connected and fine"
//     while the data is not surviving the socket is an active lie, so the alert wins.

import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import RelayStatus from './relay-status.svelte';
import type { IssueStore } from '$lib/state/issues.svelte.js';
import type { Presence } from '$lib/state/presence.svelte.js';
import type { PersistFailure, PersistenceState } from '$lib/sync/relay-notice.js';

/**
 * Exactly the six fields the component reads, and nothing else.
 *
 * Typed at those fields rather than built as a real IssueStore: constructing one would attach
 * IndexedDB and a relay provider to assert on a paragraph of text, and would quietly make this
 * a test about the store instead of about the markup.
 */
function fakeStore(overrides: {
	relayPersistence: PersistenceState;
	relayPersistenceReason?: PersistFailure;
	persisted?: boolean;
	connection?: 'local' | 'offline' | 'connecting' | 'connected';
	relaySynced?: boolean;
}) {
	return {
		persisted: overrides.persisted ?? true,
		// 'connected' throughout on purpose: it is the state that makes the icon decision
		// interesting. A relay that cannot save usually has a perfectly healthy socket.
		connection: overrides.connection ?? 'connected',
		relaySynced: overrides.relaySynced ?? true,
		relayPersistence: overrides.relayPersistence,
		relayPersistenceReason: overrides.relayPersistenceReason
	} as unknown as IssueStore;
}

const noPeers = { peers: [], others: [] } as unknown as Presence;

/** The trigger, which carries the composed aria-label and the icon. */
function trigger() {
	return page.getByTestId('relay-status');
}

/**
 * Opens the popover and hands back a closer that waits for it to actually go.
 *
 * Leaving it open is not merely untidy: the test ends, the component unmounts, and bits-ui's
 * exit sequence then reads `copy` — a `$derived` whose effect has already been destroyed.
 * Svelte warns `derived_inert` for every read, 72 of them across this file, which is exactly
 * the kind of noise that hides a real warning later.
 */
async function openPopover() {
	await trigger().click();
	await expect.element(page.getByTestId('connection-details')).toBeInTheDocument();
	return async () => {
		await trigger().click();
		await expect.element(page.getByTestId('connection-details')).not.toBeInTheDocument();
	};
}

describe('relay-status.svelte', () => {
	it('shows no durability row at all when the relay is saving', async () => {
		render(RelayStatus, { store: fakeStore({ relayPersistence: 'ok' }), presence: noPeers });

		const close = await openPopover();
		await expect.element(page.getByTestId('connection-stored')).toBeInTheDocument();
		await expect.element(page.getByTestId('connection-shared')).toBeInTheDocument();
		// The absence is the assertion: a healthy workspace must not gain a reassurance badge.
		await expect.element(page.getByTestId('connection-durable')).not.toBeInTheDocument();
		await close();
	});

	it('renders the full-relay sentence, and carries it in the trigger label', async () => {
		render(RelayStatus, {
			store: fakeStore({ relayPersistence: 'degraded', relayPersistenceReason: 'too-big' }),
			presence: noPeers
		});

		// The label is read by anyone who reaches the control without opening the popover, so
		// the fact has to be there before the click, not only after it.
		await expect
			.element(trigger())
			.toHaveAttribute('aria-label', expect.stringContaining("it's full") as unknown as string);

		const close = await openPopover();
		const durable = page.getByTestId('connection-durable');
		await expect.element(durable).toBeInTheDocument();
		await expect.element(durable).toHaveTextContent(/stopped saving this workspace/);
		// Still truthful about the two things that ARE fine, rather than collapsing them.
		await expect
			.element(page.getByTestId('connection-stored'))
			.toHaveTextContent(/Saved on this device/);
		await close();
	});

	it('takes the icon from a connected socket when the relay cannot save', async () => {
		render(RelayStatus, {
			store: fakeStore({ relayPersistence: 'degraded', relayPersistenceReason: 'unknown' }),
			presence: noPeers
		});

		// The alert is the only icon given `text-destructive`; every connection-state icon gets
		// `size-3.5` alone. So this asserts the swap happened rather than that some icon exists.
		const icon = await trigger().element().querySelector('svg');
		expect(icon).not.toBeNull();
		expect(icon?.getAttribute('class')).toContain('text-destructive');
	});

	it('says the loss already happened when the workspace came back stale', async () => {
		render(RelayStatus, { store: fakeStore({ relayPersistence: 'stale' }), presence: noPeers });

		const close = await openPopover();
		// Past tense: by the time this is known, nothing the reader does recovers the history.
		await expect.element(page.getByTestId('connection-durable')).toHaveTextContent(/was lost/);
		await close();
	});
});
