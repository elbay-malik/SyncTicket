import { defineConfig } from '@playwright/test';

/** Where the relay listens during tests; the app is built pointing at it. */
const RELAY_PORT = 8791;
const APP_PORT = 4173;

export default defineConfig({
	// A stray `test.only` left in a commit would otherwise reduce the whole e2e suite to one
	// test and still report success — CI would stay green while covering almost nothing.
	forbidOnly: !!process.env.CI,
	// Pinned explicitly. Playwright only infers baseURL from a single webServer object, and
	// with an array it infers nothing — every relative page.goto would break.
	use: { baseURL: `http://localhost:${APP_PORT}` },
	webServer: [
		{
			// The relay first, so the app has something to connect to. `port` gives a plain TCP
			// readiness check; a URL check would follow the 404 rules and never settle.
			// `--env e2e` is the same worker without the connection rate limit. The suite opens
			// more sockets per minute from one address than any real client ever would, and
			// `wrangler dev` sets `cf-connecting-ip`, so the limit would refuse our own tests.
			// See workers/relay/wrangler.jsonc for the measurements and the trade-off.
			command: `pnpm --filter syncticket-relay exec wrangler dev --port ${RELAY_PORT} --persist-to .wrangler/e2e-state --env e2e`,
			port: RELAY_PORT,
			timeout: 120_000,
			// Never adopt a server we did not start: 8787 is a common default, and reusing
			// somebody else's worker would look like a mysterious sync failure rather than a
			// port clash.
			reuseExistingServer: false
		},
		{
			// The built worker under real workerd, built against the relay above. Cold build
			// plus runtime boot can exceed Playwright's 60s default.
			command: `PUBLIC_RELAY_HOST=localhost:${RELAY_PORT} pnpm build && pnpm preview`,
			port: APP_PORT,
			timeout: 180_000,
			reuseExistingServer: !process.env.CI
		}
	],
	testMatch: '**/*.e2e.{ts,js}'
});
