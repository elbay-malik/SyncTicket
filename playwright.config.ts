import { defineConfig } from '@playwright/test';

/** Where the relay listens during tests; the app is built pointing at it. */
const RELAY_PORT = 8791;
const APP_PORT = 4173;

export default defineConfig({
	// Pinned explicitly. Playwright only infers baseURL from a single webServer object, and
	// with an array it infers nothing — every relative page.goto would break.
	use: { baseURL: `http://localhost:${APP_PORT}` },
	webServer: [
		{
			// The relay first, so the app has something to connect to. `port` gives a plain TCP
			// readiness check; a URL check would follow the 404 rules and never settle.
			command: `pnpm --filter syncticket-relay exec wrangler dev --port ${RELAY_PORT} --persist-to .wrangler/e2e-state`,
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
