// The Yjs patch is the only thing between a peer's bytes and a stack overflow, and pnpm applies it
// by exact version without saying when a package misses it. With the root on 13.6.31, the relay on
// 13.6.32 and the key still `yjs@13.6.31`, the install succeeds with no warning and the relay gets
// stock Yjs. Most of the suite loads the root's patched copy and passes: measured, two tests in the
// relay's storage.test.ts noticed, and they name a symptom. So this checks the cause: the pins, the
// key, and what each package's own `yjs` resolves to on disk.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const RELAY = join(ROOT, 'workers/relay');

// Only the patch adds this, in dist/yjs.mjs. Stock 13.6.31 does not contain the word.
const PATCH_MARKER = 'parseBoundedJSON';

const pinnedYjs = (packageDir: string): unknown =>
	JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).dependencies?.yjs;

// By line rather than through a YAML parser, which nothing here depends on. Comments in the block
// start with `#`, so a version named in one cannot pass for a key.
const patchedYjsKeys = (): string[] => {
	const workspace = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
	const block = /^patchedDependencies:\n((?:[ \t#].*\n|\n)*)/m.exec(workspace)?.[1] ?? '';
	return [...block.matchAll(/^[ \t]+['"]?(yjs(?:@[^'":]*)?)['"]?[ \t]*:/gm)].map(([, key]) => key!);
};

// Through package.json because a plain resolve from here takes the `require` condition, which is
// dist/yjs.cjs: left stock on purpose, so it would say nothing about the file the bundlers load.
const bundledYjs = (packageDir: string): string => {
	const manifest = createRequire(join(packageDir, 'package.json')).resolve('yjs/package.json');
	return readFileSync(join(dirname(manifest), 'dist/yjs.mjs'), 'utf8');
};

describe('the patched Yjs', () => {
	it('is pinned to one exact version by the root and the relay', () => {
		expect(pinnedYjs(ROOT)).toMatch(/^\d+\.\d+\.\d+$/);
		expect(pinnedYjs(RELAY)).toBe(pinnedYjs(ROOT));
	});

	it('has a patch key for exactly that version', () => {
		expect(patchedYjsKeys()).toEqual([`yjs@${pinnedYjs(ROOT)}`]);
	});

	it.each([
		['the root', ROOT],
		['the relay', RELAY]
	])('is what %s resolves', (_name, packageDir) => {
		expect(bundledYjs(packageDir)).toContain(PATCH_MARKER);
	});
});
