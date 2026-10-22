// Vite's `?raw` import, which `wrangler-coherence.test.ts` uses to read `wrangler.jsonc` as
// text. Declared here rather than by pulling in `vite/client`, which would bring the DOM lib
// into a Durable Object's program — the same reason this package's tsconfig is standalone.
declare module '*?raw' {
	const contents: string;
	export default contents;
}
