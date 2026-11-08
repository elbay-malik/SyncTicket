// The app is static files (ADR 0011): what the server used to do for a page, the files now do.

import { expect, test, type Page } from './fixtures.js';

const PAGES = ['/', '/issues', '/board', '/issues/x', '/nothing-here'];

test('every page is a static file that carries the security headers', async ({ request }) => {
	for (const path of PAGES) {
		const response = await request.get(path, { maxRedirects: 0 });
		expect(response.status(), path).toBe(200);
		const headers = response.headers();
		// The header SvelteKit's server set on every page it rendered.
		expect(headers['x-sveltekit-page'], path).toBeUndefined();
		expect(headers['content-type'], path).toContain('text/html');
		expect(headers['x-content-type-options'], path).toBe('nosniff');
		expect(headers['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
		expect(headers['x-frame-options'], path).toBe('DENY');
		expect(headers['permissions-policy'], path).toContain('camera=()');
		expect(headers['strict-transport-security'], path).toBe('max-age=31536000');
		// So the zone injects no analytics beacon, which would report the page's address.
		expect(headers['cache-control'], path).toContain('no-transform');
	}
});

test('scripts and model files can still be compressed at the edge', async ({ request }) => {
	const html = await (await request.get('/issues')).text();
	const script = html.match(/\/_app\/immutable\/[^"']+\.js/)?.[0];
	expect(script).toBeTruthy();
	for (const path of [script!, '/_app/version.json', '/ort/LICENSE.txt']) {
		const response = await request.get(path);
		expect(response.status(), path).toBe(200);
		expect(response.headers()['cache-control'], path).not.toContain('no-transform');
	}
});

test('no address sends the browser to another site', async ({ request }) => {
	for (const path of [
		'/%2F%2Fevil.example/%',
		'/%5Cevil.example/%',
		'/issues/..%2F..%2F%2Fevil.example',
		'/issues/%2F%2Fevil.example%'
	]) {
		const response = await request.get(path, { maxRedirects: 0 });
		const location = response.headers()['location'];
		if (location === undefined) continue;
		expect(new URL(location, 'http://localhost:4173').origin, path).toBe('http://localhost:4173');
	}
});

/** Serves the real page at `origin`, without a network, and records any HTTPS navigation. */
async function servePage(page: Page, html: string, origin: string) {
	const secure: string[] = [];
	await page.route(`${origin}/**`, (route) =>
		route.fulfill({ body: html, contentType: 'text/html' })
	);
	await page.route(
		(url) => url.protocol === 'https:',
		(route) => {
			secure.push(route.request().url());
			return route.fulfill({ body: '<!doctype html><title>secure</title>' });
		}
	);
	return secure;
}

test('the live host reached over plain HTTP goes on to HTTPS, keeping its path and query', async ({
	page,
	request
}) => {
	// The zone redirects first; this is the page's fallback should that setting be off.
	const html = await (await request.get('/issues')).text();
	const secure = await servePage(page, html, 'http://syncticket.elbaymalik.com');
	const ws = `t${'0'.repeat(32)}`;
	await page.goto(`http://syncticket.elbaymalik.com/issues/abc?ws=${ws}#x`);
	await expect(page).toHaveTitle('secure');
	expect(secure).toEqual([`https://syncticket.elbaymalik.com/issues/abc?ws=${ws}`]);
});

test('any other plain-HTTP host, such as a dev server on the LAN, is left alone', async ({
	page,
	request
}) => {
	const html = await (await request.get('/issues')).text();
	const secure = await servePage(page, html, 'http://192.168.1.20:5173');
	await page.goto('http://192.168.1.20:5173/issues');
	await page.waitForTimeout(500);
	expect(page.url()).toBe('http://192.168.1.20:5173/issues');
	expect(secure).toEqual([]);
});

test('a dark-mode visitor gets the dark scheme before the app has loaded', async ({ browser }) => {
	const context = await browser.newContext({ colorScheme: 'dark' });
	const page = await context.newPage();
	// Hold every script back, so only what is in the page itself can have run.
	await page.route('**/_app/**', () => {});
	await page.goto('/issues', { waitUntil: 'commit' });
	// The inline scripts sit in the head, so they have run once the body exists.
	await page.waitForFunction(() => document.body !== null);
	const root = await page.evaluate(() => ({
		dark: document.documentElement.classList.contains('dark'),
		scheme: document.documentElement.style.colorScheme
	}));
	expect(root).toEqual({ dark: true, scheme: 'dark' });
	await context.close();
});
