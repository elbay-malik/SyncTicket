// What semantic search needs served from this origin, in one place, because three things have to
// agree on it: fetch-search-assets.mjs writes these files, check-search-assets.mjs refuses to
// deploy without them, and ci-local.sh insists on them before running tests that load them.

import { stat } from 'node:fs/promises';
import { join } from 'node:path';

export const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

// Must match src/lib/search/worker.ts's `pipeline('feature-extraction', ..., { dtype: 'q8' })`
// call exactly — a different dtype resolves to a different filename on Hugging Face's side.
export const MODEL_FILES = [
	'config.json',
	'tokenizer_config.json',
	'tokenizer.json',
	'onnx/model_quantized.onnx'
];

// The one ONNX Runtime Web variant this app's bundle actually resolves to (asyncify — the
// build without native WebAssembly threading, which Vite's worker output confirms is the
// only .wasm it emits). If a dependency bump ever changes which variant gets bundled, the
// mismatch shows up immediately: search would try to fetch a filename that isn't there.
export const ORT_VARIANT = 'ort-wasm-simd-threaded.asyncify';

/** Every file a deploy must serve, relative to the directory its static assets live in. */
export const SEARCH_ASSETS = [
	...MODEL_FILES.map((file) => `models/${MODEL_ID}/${file}`),
	'models/LICENSE.txt',
	`ort/${ORT_VARIANT}.wasm`,
	`ort/${ORT_VARIANT}.mjs`,
	'ort/LICENSE.txt'
];

/** The entries of {@link SEARCH_ASSETS} that `dir` lacks. An empty file counts as lacking. */
export async function missingSearchAssets(dir) {
	const checks = await Promise.all(
		SEARCH_ASSETS.map(async (asset) => {
			try {
				return (await stat(join(dir, asset))).size > 0 ? null : asset;
			} catch {
				return asset;
			}
		})
	);
	return checks.filter((asset) => asset !== null);
}
