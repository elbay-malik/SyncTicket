# 0003 — UI stack: Svelte 5 runes, Tailwind v4, shadcn-svelte

**Status:** Accepted
**Date:** 2026-07-08

## Context

The UI must be a dense, keyboard-first, Linear-like application that later rewires its state layer onto a CRDT bridge (ADR 0001). Mid-2026 realities: Svelte 5 runes are the stable default reactivity model (`.svelte.ts` modules replace stores for shared state; SvelteKit 3 is prerelease-only); Tailwind v4 is CSS-first (no `tailwind.config.js`, theme in CSS variables); shadcn-svelte 1.3 (on bits-ui 2.18) is runes- and Tailwind-v4-native and copies components into the repo as owned code.

## Decision

Build on Svelte 5 runes + SvelteKit 2.69, styled with Tailwind v4 CSS-first and shadcn-svelte (Nova preset: Lucide icons, Geist font, compact spacing), with class-based dark mode via mode-watcher. Shared reactive state lives exclusively in `.svelte.ts` modules — no legacy stores. TypeScript is strict plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`.

## Consequences

- shadcn-svelte components in `src/lib/components/ui/` are owned code: we edit them freely (essential for wiring CRDT-driven state later) and take responsibility for updating them.
- `exactOptionalPropertyTypes` is **deliberately off**: bits-ui/shadcn-svelte's prop-forwarding pattern (`{...restProps}` into optional-prop components) fails under it in generated code (verified: 4 errors in 3 `ui/` files). One flag dropped beats sprinkling casts through owned components.
- Pre-2025 shadcn/Tailwind material is misleading and must not be followed: hsl variables, `tailwind.config.js`, `cmdk-sv`, `lucide-svelte`, `tailwindcss-animate` are all obsolete (now: oklch variables in CSS, `@custom-variant dark`, bits-ui's Command, `@lucide/svelte`, `tw-animate-css`).
- Dark mode depends on the `@custom-variant dark (&:is(.dark *));` line in `src/routes/layout.css` — deleting it silently breaks every `dark:` utility.
- mode-watcher 1.x is the runes rewrite: read `mode.current`, not the old `$mode` store.

## Alternatives considered

- **Hand-rolled components** — weeks of primitive-building with worse accessibility than bits-ui provides for free.
- **Skeleton / Flowbite-svelte** — component libraries as dependencies; we specifically want owned code to rewire onto CRDT state.
- **Tailwind v3** — LTS-only line; v4 CSS-first is the current documented mode for shadcn-svelte.
- **SvelteKit 3 / adapter v8** — prerelease; nothing load-bearing may depend on it (same rule as remote functions and async Svelte).
