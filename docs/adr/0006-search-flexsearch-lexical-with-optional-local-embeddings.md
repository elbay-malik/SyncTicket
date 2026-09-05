# 0006 — Search: FlexSearch, with local embeddings as an opt-in

**Status:** Accepted
**Date:** 2026-09-05

## Context

Phase 8 needs search over a workspace of up to 10,000 issues that returns results without a network round trip, because the whole point of this project is that the browser owns the data. Two engines were measured on 10,000 generated issues in Node before choosing (title plus description, the same corpus the app indexes):

|                                        | MiniSearch 7.2.0 | FlexSearch 0.8.212 |
| -------------------------------------- | ---------------- | ------------------ |
| Build the index                        | 49 ms            | 101 ms             |
| Query `notif`, top 20                  | 0.48 ms          | 0.008 ms           |
| Query `issue` (matches every document) | 2.38 ms          | 0.011 ms           |
| Query `s` — the first keystroke        | **3.96 ms**      | **0.005 ms**       |
| Update one document                    | 0.10 ms          | 1.3 ms             |
| Gzipped                                | 17.9 KB          | 17.2 KB            |

The gap is structural rather than incidental. MiniSearch scores every match and hands the caller a sorted array; FlexSearch stops once it has enough. For a type-ahead the very first keystroke is a single letter matching nearly everything, which is exactly where that difference is largest, and it grows with the corpus.

MiniSearch is the nicer library in every other respect: a clean documented API, honest TypeScript, and incremental updates that are thirteen times faster — which matters here, because the corpus is a live CRDT rather than a static index.

## Decision

Use **FlexSearch 0.8.212** for lexical search, behind a wrapper (`search/lexical.ts`) that exposes ids and strings and keeps FlexSearch's types out of the rest of the codebase.

Run it in a **module Web Worker**, together with an **optional** embedding model (`@huggingface/transformers` 4.2.0, `Xenova/all-MiniLM-L6-v2`, q8) that is downloaded only when the user asks for it. Combine the two rankings with **Reciprocal Rank Fusion**.

## Consequences

- **Search is local.** With the model off, nothing is fetched at all — proven by an end-to-end test that records every request while five queries are typed and asserts the list is empty. Search also works with the network disabled.
- **Lexical results never wait for anything.** They are available immediately, during the model download, and if the download fails. The mode is reported in the palette rather than assumed, and the worker only claims `hybrid` when every indexed document has a current vector.
- **Title and description are indexed as one combined field, plus the title again.** FlexSearch requires every term of a query to appear in the same field, so indexing them separately makes "sync offline" find nothing when the words are split across the two — worse than the substring filter it replaces. Indexing the title separately as well is what keeps title matches ranked first.
- **`limit` is per field in FlexSearch**, so the wrapper merges and slices. Passing it through would have returned up to twice what was asked for.
- **The document type must be a type alias, not an interface.** FlexSearch constrains its generic to an index signature, and TypeScript gives those to aliases but not to interfaces.
- **Vite's worker format had to change to `es`.** The default, `iife`, cannot code-split a worker, so it silently inlines dynamic imports — the embedding library would have shipped to every visitor the moment the worker started, defeating the opt-in entirely.
- **The worker starts at app load, not on first search.** Its chunk is fetched when it is constructed, so a user who has already gone offline could never fetch it. Same reasoning as the issues layout preloading the detail route.
- **Embedding is batched and yields between batches.** ONNX inference is synchronous on the calling thread, so embedding ten thousand documents in one pass would block the worker for minutes and queries would queue behind it. Vectors are invalidated per document when the indexed text changes, and a generation counter abandons any batch whose corpus moved underneath it.
- **The palette does its own command filtering.** bits-ui scores each item's value against the query and hides the rest, which would delete exactly the results hybrid search exists to find — a description-only match scores zero against a title. Filtering is switched off and re-implemented with bits-ui's own `computeCommandScore`, so commands behave as before.
- **Warm-up is not local.** The model comes from Hugging Face and the ONNX runtime from jsDelivr. That is a deliberate one-time cost behind an explicit click, and it is the only time the app talks to anyone.
- **A 22.5 MB WASM binary is emitted into the build and never served.** `onnxruntime-web` references its binaries with `new URL`, so the bundler copies one in, while the runtime fetches its own from jsDelivr. Rollup's `external` does not govern assets emitted this way, so removing it needs a small Vite plugin or a pinned self-hosted copy. It is dead weight in the deploy — under Cloudflare's 25 MiB per-file limit, but only just — and Phase 12 should either suppress it or point the runtime at it deliberately.

## Alternatives considered

- **MiniSearch 7.2.0** — better API, better types, much faster incremental updates, and a real candidate. Rejected because per-query cost scales with the number of matches, and the query a user types first is the one that matches everything.
- **Orama** — capable, and it has vector search built in, which would have removed the fusion code. Not measured in depth; its hybrid support assumes it owns both indexes, and this project wanted the ranking to be explicit and testable rather than delegated.
- **Rendering search through the existing filter** (`filterIssues`) — already there, and substring matching over 10,000 issues is not slow. Rejected because it cannot rank, cannot match prefixes, and cannot be extended with meaning.
- **Semantic search on by default** — a 23 MB download nobody asked for, on a first visit, for a feature most queries do not need.
- **Self-hosting the model and runtime** — removes the third-party dependency and would make search fully offline from a cold start, at the cost of roughly 45 MB of deploy per workspace. Worth revisiting in Phase 12, where deployment is the subject.
