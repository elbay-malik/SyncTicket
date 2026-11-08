import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

/**
 * `vite dev` doing what Cloudflare's asset server does for the built site (ADR 0011): a path
 * `decodeURI` refuses goes to the same text with each `%` encoded. SvelteKit's client throws on
 * such a path while it starts, so without this the dev server shows a bare error page where the
 * live site shows an issue that was not found.
 */
function decodes(path: string): boolean {
	try {
		// The result is used on purpose: the config bundler drops a call to `decodeURI` whose
		// result nothing reads, as free of side effects, and with it the throw.
		return typeof decodeURI(path) === 'string';
	} catch {
		return false;
	}
}

const malformedPaths: Plugin = {
	name: 'syncticket:malformed-paths',
	// Ahead of SvelteKit's own dev middleware, which is `pre` too and would answer first.
	enforce: 'pre',
	configureServer(server) {
		server.middlewares.use((request, response, next) => {
			const [path = '', query] = (request.url ?? '').split(/\?(.*)/s, 2);
			if (decodes(path)) return next();
			const location = path.replaceAll('%', '%25') + (query === undefined ? '' : `?${query}`);
			response.statusCode = 307;
			// Same-origin only: a path starting `//` would read as another host.
			response.setHeader('location', location.replace(/^\/+/, '/'));
			response.end();
		});
	}
};

export default defineConfig({
	// Module workers must be code-split, not inlined. Vite's default worker format is 'iife',
	// which cannot split a worker bundle and so silently inlines any dynamic import into it —
	// that would ship the whole embedding library to every visitor the moment the search
	// worker starts, which is exactly what loading it on demand is meant to avoid.
	worker: { format: 'es' },
	// Vite only inlines VITE_-prefixed variables into import.meta.env. The relay host is read
	// there rather than through $env/dynamic/public, because that virtual module needs the
	// SvelteKit runtime and does not resolve in browser-mode unit tests.
	envPrefix: ['VITE_', 'PUBLIC_'],
	optimizeDeps: {
		// The search worker's imports are not reachable from the app's own module graph, so
		// Vite only discovers them when the worker first runs — mid-page-load, which forces a
		// re-optimisation and a reload that can kill the dev server outright. Naming them here
		// gets them pre-bundled at startup instead.
		include: ['flexsearch'],
		// Excluded rather than included: it is only imported when someone turns on semantic
		// search, and pre-bundling it would add a very large dependency to every dev start.
		exclude: ['@huggingface/transformers']
	},
	plugins: [
		malformedPaths,
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Static files and one page for every address: Cloudflare serves them without running a
			// Worker, so no number of page loads touches the daily request budget (ADR 0011).
			adapter: adapter({ fallback: 'index.html' })
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				// The relay is a separate workspace package; the projects below only glob src/**,
				// so without this its tests are collected by nothing and CI stays green regardless.
				extends: './vite.config.ts',
				test: {
					name: 'relay',
					environment: 'node',
					include: ['workers/**/*.{test,spec}.ts']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
