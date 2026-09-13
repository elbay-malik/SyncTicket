#!/usr/bin/env node
// One-time setup for a fully self-hosted semantic search: vendors the embedding model and
// the ONNX runtime as static assets, so the deployed app never talks to Hugging Face or
// jsDelivr — not at build time, and not in a visitor's browser.
//
// Run once before the first build that needs semantic search (`pnpm fetch:search-assets`).
// The files it writes are gitignored, not committed: ~46 MB of vendored binary weights has
// no business living in git history forever, and this script is the reproducible way to get
// them back — on a fresh clone, in CI, or after `pnpm build` reports them missing.
//
// The two onnxruntime-web files are *copied* from node_modules rather than fetched from
// jsDelivr, deliberately: they are byte-identical to what the app already downloads
// (npm and jsDelivr serve the exact same published package), and copying keeps them
// version-locked to whatever `@huggingface/transformers` actually resolves onnxruntime-web
// to, with no network request and no risk of drifting from it.

import { createRequire } from 'node:module';
import { mkdir, copyFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * onnxruntime-web is a transitive dependency (through `@huggingface/transformers`), so pnpm
 * never hoists it to the top-level `node_modules` this script's own `require` sees — and its
 * own `package.json` refuses subpath resolution outside its declared `exports`. Resolving a
 * real entry file scoped to transformers' own resolution and trimming the path back to the
 * package root sidesteps both: it asks Node for something both packages actually agree is
 * resolvable, rather than a path shape this one happens to have on disk today.
 */
function findOnnxRuntimeWebRoot() {
	const transformersEntry = require.resolve('@huggingface/transformers');
	const scopedRequire = createRequire(transformersEntry);
	const ortEntry = scopedRequire.resolve('onnxruntime-web');
	const marker = `${join('node_modules', 'onnxruntime-web')}${sep}`;
	const index = ortEntry.indexOf(marker);
	if (index === -1) {
		throw new Error(`could not locate the onnxruntime-web package root from ${ortEntry}`);
	}
	return ortEntry.slice(0, index + marker.length);
}

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const MODEL_DIR = join(root, 'static', 'models', MODEL_ID);
const ORT_DIR = join(root, 'static', 'ort');

// Must match src/lib/search/worker.ts's `pipeline('feature-extraction', ..., { dtype: 'q8' })`
// call exactly — a different dtype resolves to a different filename on Hugging Face's side.
const MODEL_FILES = [
	'config.json',
	'tokenizer_config.json',
	'tokenizer.json',
	'onnx/model_quantized.onnx'
];

// The one ONNX Runtime Web variant this app's bundle actually resolves to (asyncify — the
// build without native WebAssembly threading, which Vite's worker output confirms is the
// only .wasm it emits). If a dependency bump ever changes which variant gets bundled, the
// mismatch shows up immediately: search would try to fetch a filename that isn't there.
const ORT_VARIANT = 'ort-wasm-simd-threaded.asyncify';

async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function fetchModelFile(filename) {
	const dest = join(MODEL_DIR, filename);
	if (await exists(dest)) {
		console.log(`  skip (already present): ${filename}`);
		return;
	}
	await mkdir(dirname(dest), { recursive: true });
	const url = `https://huggingface.co/${MODEL_ID}/resolve/main/${filename}`;
	console.log(`  fetching ${url}`);
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`${url} → HTTP ${response.status}`);
	}
	const bytes = Buffer.from(await response.arrayBuffer());
	await writeFile(dest, bytes);
	console.log(`  wrote ${filename} (${bytes.byteLength.toLocaleString()} bytes)`);
}

async function copyOrtAsset(ortRoot, extension) {
	const filename = `${ORT_VARIANT}.${extension}`;
	const dest = join(ORT_DIR, filename);
	if (await exists(dest)) {
		console.log(`  skip (already present): ${filename}`);
		return;
	}
	const source = join(ortRoot, 'dist', filename);
	await mkdir(ORT_DIR, { recursive: true });
	await copyFile(source, dest);
	const { size } = await stat(dest);
	console.log(`  copied ${filename} from node_modules (${size.toLocaleString()} bytes)`);
}

async function main() {
	console.log(`Vendoring ${MODEL_ID} into ${MODEL_DIR}`);
	for (const filename of MODEL_FILES) await fetchModelFile(filename);

	console.log(`Vendoring the ONNX Runtime (${ORT_VARIANT}) into ${ORT_DIR}`);
	const ortRoot = findOnnxRuntimeWebRoot();
	await copyOrtAsset(ortRoot, 'wasm');
	await copyOrtAsset(ortRoot, 'mjs');

	console.log('Done. Semantic search will now load entirely from this origin.');
}

main().catch((error) => {
	console.error('fetch-search-assets failed:', error.message);
	console.error(
		'Semantic search will still work without these files (search/worker.ts falls back to\n' +
			'Hugging Face + jsDelivr when they are absent), but the deploy will depend on both\n' +
			'being reachable at demo time. Re-run this script, or check network access, then retry.'
	);
	process.exitCode = 1;
});
