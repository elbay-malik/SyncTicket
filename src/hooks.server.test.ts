// A path decodeURI refuses reaches the app as a 400 from SvelteKit's server, whose client then
// throws decoding that same path while it starts, so it never hydrates: the palette and shortcuts
// do nothing and `?ws=` is never written back. Doubling each `%` is the only rewrite that is right
// for every such path, because the segment then decodes to the text that was typed, which is an
// issue nobody can find rather than one somebody could mean. Real pages: e2e/hostile-issue-id.e2e.ts.

import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { handle } from './hooks.server.js';

const WORKSPACE = `w${'deadbeef'.repeat(4)}`;

async function respondTo(path: string) {
	const url = new URL(path, 'https://app.example');
	const resolve = vi.fn(async () => new Response('page'));
	const response = await handle({ event: { url } as RequestEvent, resolve });
	return { response, resolve };
}

describe('a path that decodeURI refuses', () => {
	it.each([
		['/issues/%', '/issues/%25'],
		['/issues/%E0%A4%A', '/issues/%25E0%25A4%25A'],
		['/issues/%ZZ', '/issues/%25ZZ'],
		['/issues/%FF', '/issues/%25FF'],
		['/issues/%C0%AF', '/issues/%25C0%25AF'],
		['/issues/%ED%A0%80', '/issues/%25ED%25A0%2580'],
		['/board/%', '/board/%25'],
		['/%', '/%25'],
		['/issues/%41%', '/issues/%2541%25']
	])('sends %s to %s without rendering it', async (from, to) => {
		const { response, resolve } = await respondTo(from);

		expect(resolve).not.toHaveBeenCalled();
		expect(response.status).toBe(308);
		const location = new URL(response.headers.get('location') ?? '');
		expect(location.origin).toBe('https://app.example');
		expect(location.pathname).toBe(to);
		// And there it stays: decodeURI takes it, which is what the app's client needs.
		expect(() => decodeURI(location.pathname)).not.toThrow();
		expect((await respondTo(location.pathname)).resolve).toHaveBeenCalledOnce();
	});

	it('stays in the workspace it was given', async () => {
		const { response } = await respondTo(`/issues/%?ws=${WORKSPACE}&x=%`);
		expect(new URL(response.headers.get('location') ?? '').search).toBe(`?ws=${WORKSPACE}&x=%`);
	});

	it.each(['//evil.example/%', '//evil.example/%/', '/\\evil.example/%', '//%'])(
		'cannot be made to leave the site by %s',
		async (path) => {
			const url = new URL('https://app.example');
			url.pathname = path;
			const resolve = vi.fn(async () => new Response('page'));
			const response = await handle({ event: { url } as RequestEvent, resolve });
			expect(new URL(response.headers.get('location') ?? '', url).origin).toBe(
				'https://app.example'
			);
		}
	);

	it('still carries the security headers', async () => {
		const { response } = await respondTo('/issues/%');
		expect(response.headers.get('X-Frame-Options')).toBe('DENY');
		expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
	});
});

describe('every other path', () => {
	it.each([
		'/',
		'/issues',
		'/issues/%25',
		'/issues/%25ZZ',
		'/issues/%2525',
		'/issues/%20',
		'/issues/%2F',
		'/issues/caf%C3%A9',
		`/issues/00000000-0000-4000-8000-00000000000a?ws=${WORKSPACE}`
	])('%s goes to the app untouched', async (path) => {
		const { response, resolve } = await respondTo(path);

		expect(resolve).toHaveBeenCalledOnce();
		expect(await response.text()).toBe('page');
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
	});
});
