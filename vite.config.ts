import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';

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
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
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
