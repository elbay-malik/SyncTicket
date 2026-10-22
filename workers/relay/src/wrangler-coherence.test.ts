// The one coupling in this package that nothing else can check: `CONNECT_LIMIT` in `limits.ts`
// and the `ratelimits` block in `wrangler.jsonc` are two copies of the same two numbers, and
// only the config's copy is the one Cloudflare enforces. Drift means `limits.test.ts` goes on
// asserting a limit that is not the deployed limit.
//
// This used to be left to a human reading the dry-run's output, which three comments
// nonetheless described as drift "failing the suite". It does now.
//
// Read through Vite's `?raw` rather than `node:fs`: Node's types cannot be added to this
// package without colliding with workerd's (they disagree about `URLSearchParams`, among
// others), and the vitest `relay` project extends the root Vite config, so `?raw` works here
// while `node:fs` would cost a second tsconfig and a weaker production program.

import { describe, expect, it } from 'vitest';
import wranglerConfig from '../wrangler.jsonc?raw';
import { CONNECT_LIMIT } from './limits.js';

/**
 * The deployed limit, read out of the config rather than trusted.
 *
 * Matched narrowly instead of parsing the whole JSONC: a comment-stripping parser is a
 * liability of its own (`//` inside a string), and a shape this test cannot find is itself a
 * failure worth reporting — if the `ratelimits` block moves or is renamed, the numbers this
 * file is guarding are no longer where it thinks they are.
 */
function deployedLimit(): { limit: number; period: number } {
	const match = wranglerConfig.match(
		/"simple":\s*\{\s*"limit":\s*(\d+)\s*,\s*"period":\s*(\d+)\s*\}/
	);
	if (!match) {
		throw new Error(
			'No `"simple": { "limit": …, "period": … }` block in workers/relay/wrangler.jsonc. ' +
				'Either the rate limit was removed — in which case delete this test and say so in ' +
				'limits.ts — or the block was reshaped and this guard is now looking in the wrong place.'
		);
	}
	return { limit: Number(match[1]), period: Number(match[2]) };
}

describe('wrangler.jsonc and limits.ts agree', () => {
	it('deploys the limit that limits.ts documents', () => {
		// If this fails, the config is right and the constant is wrong: Cloudflare enforces the
		// config, so `CONNECT_LIMIT` is the copy to correct.
		expect(deployedLimit()).toEqual({ limit: CONNECT_LIMIT.limit, period: CONNECT_LIMIT.period });
	});

	it('does not quietly lose the rate limit from the deployed environment', () => {
		// The top-level environment is what `--env=""` deploys. `env.e2e` deliberately omits the
		// binding (bindings are not inherited unless redeclared), which is the whole point of
		// that environment — so this asserts the binding exists before `env` is declared, rather
		// than merely somewhere in the file.
		const beforeEnvBlock = wranglerConfig.slice(0, wranglerConfig.indexOf('"env"'));
		expect(beforeEnvBlock).toContain('"ratelimits"');
		expect(beforeEnvBlock).toContain('"CONNECT_LIMIT"');
	});
});
