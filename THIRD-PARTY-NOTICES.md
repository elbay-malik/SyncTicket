# Third-party notices

SyncTicket's own source is MIT ([LICENSE](LICENSE)). This file covers the third-party
works the **deployed app distributes from its own origin** — which is a different and
larger obligation than merely depending on them.

Two of these are unusual enough to be worth stating plainly: the embedding model and the
ONNX runtime are not bundled into a JS chunk, they are served as standalone binaries
(`/models/…`, `/ort/…`) that a visitor's browser downloads whole. Anyone who fetches
those files is a recipient of the underlying work and is owed its license, so the notice
is served next to them (`/models/LICENSE.txt`, `/ort/LICENSE.txt`) and not only kept here
in the repository. See [ADR 0009](docs/adr/0009-self-host-the-embedding-model-and-onnx-runtime.md)
for why they are self-hosted at all.

Nothing below has been modified. SyncTicket redistributes each work verbatim.

## Served as standalone files

### Xenova/all-MiniLM-L6-v2 — Apache-2.0

Served at `/models/Xenova/all-MiniLM-L6-v2/` (`config.json`, `tokenizer.json`,
`tokenizer_config.json`, `onnx/model_quantized.onnx`). An ONNX export, quantized to int8,
of `sentence-transformers/all-MiniLM-L6-v2`; both the export and its base model are
Apache-2.0.

- https://huggingface.co/Xenova/all-MiniLM-L6-v2
- https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
- License text: [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt)

### ONNX Runtime Web (Microsoft) — MIT

Served at `/ort/ort-wasm-simd-threaded.asyncify.wasm` and `….mjs`, copied verbatim from
the installed `onnxruntime-web` package. That npm package ships no license file of its
own, so the text below comes from the upstream repository.

- https://github.com/microsoft/onnxruntime
- License text: [licenses/MIT-onnxruntime.txt](licenses/MIT-onnxruntime.txt)

## Compiled into the shipped JavaScript

### @huggingface/transformers (Transformers.js) — Apache-2.0

- https://github.com/huggingface/transformers.js
- License text: [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt)

### FlexSearch — Apache-2.0

- https://github.com/nextapps-de/flexsearch
- License text: [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt)

## Everything else

The remaining runtime dependencies (SvelteKit, Yjs, y-partyserver, bits-ui, Tailwind CSS,
Lucide icons and their transitive dependencies) are MIT or ISC and are bundled, not
redistributed as standalone artifacts. Their license texts travel with the packages in
`node_modules/`; `pnpm licenses list` prints the current set for any given install.
