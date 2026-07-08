# AGENTS.md — conventions for coding agents (and humans)

Commands, conventions, and stale-training-data traps. Rationale lives in `docs/adr/`.

## Toolchain

- **pnpm only** (`packageManager` pins `pnpm@11.10.0`). Use `pnpm dlx` / `pnpm exec`, never npm/npx. Node 24 via `.nvmrc` (fnm auto-switches).
- Postinstall build scripts are allowlisted in `pnpm-workspace.yaml` (`allowBuilds`: workerd, esbuild, …). If `pnpm install` reports newly blocked builds, add them there — don't run interactive `pnpm approve-builds`.
- `pnpm check` must pass; it runs `wrangler types --check` first, so run `pnpm cf-typegen` after touching `wrangler.jsonc` (the generated `worker-configuration.d.ts` is committed, prettier-ignored).

## Svelte / TypeScript

- **Runes only** (`$state` / `$derived` / `$effect`); no legacy stores. Shared reactive state goes in `.svelte.ts` modules under `src/lib/state/`.
- mode-watcher 1.x: read `mode.current` (not the old `$mode` store); set via `setMode()` / `resetMode()`.
- TS is strict + extras; `exactOptionalPropertyTypes` is deliberately off (ADR 0003) — don't re-enable it.
- `checkJs` must also stay off: `worker-configuration.d.ts` imports the built worker entry, so after any build the JS bundle artifacts enter the TS program and would fail `pnpm check`.
- Navigation needs `resolve()` from `$app/paths` (eslint `svelte/no-navigation-without-resolve`); the rule is disabled only for the generic `ui/` primitives.

## Styling

- Tailwind **v4 CSS-first**: there is no `tailwind.config.js` and never will be. Theme lives in `src/routes/layout.css` (oklch variables). Never delete the `@custom-variant dark (&:is(.dark *));` line — it is class-based dark mode.
- shadcn-svelte components in `src/lib/components/ui/` are **owned code** — edit them. Add new ones with `pnpm exec shadcn-svelte add <name>`, then run `pnpm format` (generated code fails `prettier --check`).
- Icons: `@lucide/svelte` (deep imports: `@lucide/svelte/icons/x`). Not `lucide-svelte`, not `cmdk-sv`, not `tailwindcss-animate` — all obsolete.

## Versions

- Never install `@next` dist-tags: kit 3 / adapter-cloudflare 8 are prereleases; the shadcn-svelte/bits-ui `next` tags are _stale pre-1.0 leftovers older than latest_. Check with `npm view <pkg> dist-tags`.
- `compatibility_date` in wrangler.jsonc is capped by the pinned wrangler's bundled workerd — bump them together, then verify with `pnpm preview` (ADR 0002).

## Cloudflare

- **Two-worker rule**: never add Durable Object classes or migrations to the root `wrangler.jsonc`. DOs belong to `workers/relay/` with its own config; the app worker binds cross-script via `script_name` (ADR 0002).

## Tests

- `src/**/*.test.ts` → Vitest node project. `src/**/*.svelte.test.ts` → Vitest browser mode (needs `pnpm exec playwright install chromium`). `e2e/*.e2e.ts` → Playwright, whose webServer runs the **built worker under workerd** (`pnpm build && pnpm preview`, port 4173) — not vite preview.

## Commits

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `ci:`); imperative subject ≤ 72 chars.
