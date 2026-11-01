// Where an issue found in the palette takes you. The results are read from the store, so a peer's
// bad key cannot get here (sync/doc.ts); the stub is what lets this exercise the layer behind
// that, with SvelteKit's real `resolve()`.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { goto } from '$app/navigation';
import { issueUi } from '$lib/state/ui.svelte.js';
import CommandMenu from './command-menu.svelte';

const found = vi.hoisted(() => ({ id: '' }));

vi.mock('$app/navigation', async (importOriginal) => ({
	...(await importOriginal<typeof import('$app/navigation')>()),
	goto: vi.fn()
}));

vi.mock('$lib/search/client.svelte.js', () => ({
	getSearchClient: () => ({
		ids: [found.id],
		semantic: 'off',
		progress: 0,
		search: () => {},
		warm: () => {}
	})
}));

vi.mock('$lib/state/issues.svelte.js', () => ({
	getIssueStore: () => ({
		get: (id: string) => ({ id, title: 'Fix login', status: 'todo' })
	})
}));

afterEach(() => {
	issueUi.paletteOpen = false;
	vi.mocked(goto).mockClear();
});

async function select(id: string): Promise<unknown> {
	found.id = id;
	issueUi.paletteOpen = true;
	await render(CommandMenu);
	await page.getByRole('option', { name: 'Fix login' }).click();
	await vi.waitFor(() => expect(goto).toHaveBeenCalledOnce());
	return vi.mocked(goto).mock.calls[0]?.[0];
}

describe('an issue selected in the command menu', () => {
	it('leaves a real id exactly as it is', async () => {
		const id = crypto.randomUUID();
		expect(await select(id)).toBe(`/issues/${id}`);
	});

	it('cannot be taken out of its path segment by the id', async () => {
		const id = `../issues?ws=w${'deadbeef'.repeat(4)}`;
		expect(await select(id)).toBe(`/issues/${encodeURIComponent(id)}`);
	});
});
