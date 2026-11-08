// The check that stops a deploy shipping no semantic search. The files are gitignored, so without
// it a deploy from a fresh checkout succeeds and "Add meaning search" fails for every visitor.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { missingSearchAssets, SEARCH_ASSETS } from '../../../scripts/search-assets.mjs';

const dirs: string[] = [];

afterEach(() => {
	while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function checkoutWith(assets: readonly string[], content = 'x'): string {
	const dir = mkdtempSync(join(tmpdir(), 'search-assets-'));
	dirs.push(dir);
	for (const asset of assets) {
		mkdirSync(dirname(join(dir, asset)), { recursive: true });
		writeFileSync(join(dir, asset), content);
	}
	return dir;
}

function runCheck(dir: string, wranglerCommand?: string) {
	const env: NodeJS.ProcessEnv = { ...process.env };
	delete env.WRANGLER_COMMAND;
	if (wranglerCommand) env.WRANGLER_COMMAND = wranglerCommand;
	return spawnSync(process.execPath, ['scripts/check-search-assets.mjs', dir], {
		encoding: 'utf8',
		env
	});
}

describe('missingSearchAssets', () => {
	it('lists everything for a checkout that never fetched them', async () => {
		await expect(missingSearchAssets(checkoutWith([]))).resolves.toEqual([...SEARCH_ASSETS]);
	});

	it('lists nothing when they are all there', async () => {
		await expect(missingSearchAssets(checkoutWith(SEARCH_ASSETS))).resolves.toEqual([]);
	});

	it('counts an empty file as missing, as an interrupted copy leaves', async () => {
		await expect(missingSearchAssets(checkoutWith(SEARCH_ASSETS, ''))).resolves.toEqual([
			...SEARCH_ASSETS
		]);
	});

	it('names the one file that is missing', async () => {
		const [first, ...rest] = SEARCH_ASSETS;
		await expect(missingSearchAssets(checkoutWith(rest))).resolves.toEqual([first]);
	});
});

describe('check-search-assets.mjs', () => {
	it('fails a deploy from a checkout without them', () => {
		const result = runCheck(checkoutWith([]), 'deploy');
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('pnpm fetch:search-assets');
	});

	it('fails when run outside wrangler, as `pnpm deploy` runs it', () => {
		expect(runCheck(checkoutWith([])).status).toBe(1);
	});

	it('passes a deploy that has them', () => {
		expect(runCheck(checkoutWith(SEARCH_ASSETS), 'deploy').status).toBe(0);
	});

	it('leaves `wrangler dev` alone, so a fresh clone can still preview', () => {
		expect(runCheck(checkoutWith([]), 'dev').status).toBe(0);
	});

	it('leaves `wrangler types` alone, which CI runs before it fetches them', () => {
		expect(runCheck(checkoutWith([]), 'types').status).toBe(0);
	});

	it('stops `wrangler versions upload`, and any command it has not heard of', () => {
		expect(runCheck(checkoutWith([]), 'versions upload').status).toBe(1);
		expect(runCheck(checkoutWith([]), 'something new').status).toBe(1);
	});
});

describe('where the check is wired in', () => {
	it('runs ahead of every wrangler deploy of the app, against what gets uploaded', () => {
		expect(readFileSync('wrangler.jsonc', 'utf8')).toContain(
			'"command": "node scripts/check-search-assets.mjs build"'
		);
	});

	it('runs before `pnpm deploy` touches the relay', () => {
		const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
		const check = scripts.deploy.indexOf('check-search-assets.mjs static');
		expect(check).toBeGreaterThan(-1);
		expect(check).toBeLessThan(scripts.deploy.indexOf('syncticket-relay run deploy'));
	});
});
