import { defineConfig } from '@playwright/test';

export default defineConfig({
	// The webServer runs the production build under workerd via `wrangler dev` — cold
	// build + runtime boot can exceed Playwright's 60s default, hence the longer timeout.
	webServer: { command: 'pnpm build && pnpm preview', port: 4173, timeout: 180_000 },
	testMatch: '**/*.e2e.{ts,js}'
});
