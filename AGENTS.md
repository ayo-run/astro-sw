# AGENTS.md

This file provides guidance to any AI Coding Agent / Assistant when working with code in this repository.

## What this is

`@ayco/astro-sw` — an Astro integration that lets a project ship its **own hand-authored service worker**, with build-time asset lists injected into it. Published to npm; source of truth repo is `git.ayo.run` (`origin`), mirrored to GitHub (`gh`) and SourceHut (`sh`).

## Repo layout (pnpm workspace)

- `package/` — the published package `@ayco/astro-sw` (the only thing that ships)
- `demo/` — Astro `output: 'server'` demo, previewed through a Fastify server (`demo/server.mjs`)
- `demo-static/` — Astro `output: 'static'` demo, previewed with `astro preview`

Both demos consume the package via `workspace:*`, so changes to `package/src` require a rebuild before the demos see them — which is why almost every root script chains `pnpm run build` first.

## Commands

Run everything from the repo root:

```bash
pnpm run build          # tsup build of package/ (also copies README.md into package/)
pnpm run test           # vitest run in package/
pnpm run lint           # eslint with cache
pnpm run format         # prettier --write
pnpm run check          # format + lint

pnpm run dev            # build package + build & preview the SSR demo (Fastify, port 4321)
pnpm run dev:static     # build package + build & preview the static demo
```

Single test: `pnpm -F @ayco/astro-sw exec vitest run test/astro-sw.test.ts` (or `-t '<name>'` to filter by test name). The package test suite is currently a placeholder.

Release: `pnpm run bump:build:publish` (bumpp → tsup → `npm publish` from `package/`).

`postinstall` runs `pnpm run build`, and the husky `pre-commit` hook runs lint + test. `post-commit` pushes to the `gh` and `sh` mirrors automatically — expect commits to be pushed to public remotes as a side effect of committing.

## Architecture

`package/src/astro-sw.ts` is essentially the whole integration; everything else is supporting types/presets. It is a single `AstroIntegration` using four hooks:

1. **`astro:config:setup`** — records `config.output` (needed later to decide whether to walk the public/dist tree) and, only when `command === 'build'`, injects a page-level registration script. That script is built by **stringifying the user's `registrationHooks` callbacks** (`fn.toString()`) into inline source — so those hooks must be self-contained; they cannot close over anything in `astro.config.mjs`.
2. **`astro:config:done`** — `injectTypes` a `caching.d.ts` declaring `__assets`, `__version`, `__prefix` so user service workers typecheck.
3. **`astro:build:ssr`** — captures `manifest.assets` (SSR-only source of assets).
4. **`astro:build:done`** — the real work. Builds the `__assets` list, then:
   - writes `<swPath>.tmp.ts` = `const __assets/__version/__prefix = …` prepended to the user's raw service worker source,
   - runs `esbuild.build({bundle: true, platform: 'browser', ...userEsbuild})` on that temp file to `<outDir>/sw.js`,
   - unlinks the temp file.

   The variable injection is deliberately textual prepend-then-bundle, not a define/replace plugin. Anything that changes how the SW is compiled goes through the user-supplied `esbuild` options object.

### The `__assets` list

Assembled in `astro:build:done` from, de-duped via a `Set`:
`ssrAssets` (SSR manifest) + user `include` + `assets` map keys from the build (dropping `...slug` routes) + `pages` (both with and without trailing slash, since Astro's `pages` always end in `/`) + — **only when `output === 'static'`** — a recursive `readdir` of the output dir to pick up `public/` files.

Then filtered to drop empties, anything containing `404` or `index.html`, and the user's `exclude` list (matched both bare and with a trailing slash).

Static and server outputs therefore reach the asset list by different paths; a change to asset collection must be checked in **both** demos (`pnpm run dev` and `pnpm run dev:static`), which is what the two demo workspaces exist for.

### Presets (incomplete)

`package/src/presets/` exports `staleWhileRevalidate()` and `deleteOldCaches()` as `AstroServiceWorkerPreset` objects (`install`/`activate`/`fetch` handlers). They are exported from the package and importable at `@ayco/astro-sw/presets`, but **`astro-sw.ts` does not consume `options.presets` yet** — it only `console.log`s it. Both demos have the preset import commented out. Same for `AstroServiceWorkerConfig.experimental.strategy` and `customRoutes`: typed but unimplemented.

### eslint globals export

`@ayco/astro-sw/globals` (`package/src/eslint/globals.ts`) exports `{__prefix, __version, __assets}` as read-only globals so consumers' `no-undef` doesn't fire on injected variables. This repo's own `eslint.config.mjs` imports it from the workspace package — meaning **linting requires the package to be built first**.

## Conventions

- Prettier: no semicolons, single quotes, es5 trailing commas, 2-space tabs. HTML/MD/CSS/YAML are prettier-ignored.
- ESM only (`"type": "module"`), Node >= 18, Astro `^6` peer dep.
- `package/README.md` is generated — it's copied from the root `README.md` during build and is gitignored. Edit the **root** `README.md`.
