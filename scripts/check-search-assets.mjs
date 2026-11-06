#!/usr/bin/env node
// Refuses a deploy that would ship an app with no semantic search.
//
// The model and the ONNX runtime are gitignored, so a fresh clone or worktree does not have them,
// and nothing else notices: the build succeeds, the deploy succeeds, every page loads, and
// "Add meaning search" fails for every visitor. That is how the 2026-11-02 deploy went out.
//
// `wrangler.jsonc` runs this as a custom build, which is why it stops `wrangler deploy` however it
// was reached, including the long form in docs/DEPLOY.md that skips `pnpm deploy`. It looks at the
// build output rather than `static/`, because that is what gets uploaded.
//
// Wrangler runs custom builds for more than deploys, and says which command is running in
// WRANGLER_COMMAND. `wrangler dev` is a preview, where a fresh clone has every right to lack these
// files. `wrangler types` runs inside `pnpm check` and `pnpm build`, the first of them in CI before
// the files are fetched and before there is any build output to look at. Those two are let through
// by name rather than `deploy` being checked for, so a command this does not know about is stopped.
//
// Usage: node scripts/check-search-assets.mjs <directory>

import { missingSearchAssets } from './search-assets.mjs';

const dir = process.argv[2];
if (!dir) {
	console.error('usage: check-search-assets.mjs <directory>');
	process.exit(2);
}

if (['dev', 'types'].includes(process.env.WRANGLER_COMMAND ?? '')) process.exit(0);

const missing = await missingSearchAssets(dir);
if (missing.length > 0) {
	console.error(`Self-hosted search assets are missing from ${dir}:`);
	for (const asset of missing) console.error(`  ${asset}`);
	console.error(
		'Without them "Add meaning search" fails for every visitor. Run `pnpm fetch:search-assets`\n' +
			'in this checkout (a fresh clone or worktree needs it too), rebuild, and try again.'
	);
	process.exit(1);
}
console.log(`search assets present in ${dir}`);
