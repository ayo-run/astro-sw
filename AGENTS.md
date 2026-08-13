# AGENTS.md

This file provides guidance to any AI Coding Agent / Assistant when working with code in this repository.

## What this is

`@ayco/astro-sw` — an Astro integration that lets a project ship its **own hand-authored service worker**, with build-time asset lists injected into it. Published to npm; source of truth repo is `git.ayo.run` (`origin`), mirrored to SourceHut (`sh`) and to GitHub (`gh`), which is where releases are published from. See [Releasing](#releasing).

## Repo layout (pnpm workspace)

The **repo root is the published package** — `package.json` at the root is `@ayco/astro-sw`, and `files` limits the tarball to `dist`, `LICENSE`, `README.md`, `package.json`.

- `src/` — the integration source (the only thing that ships, after a build to `dist/`)
- `test/` — vitest suite, run from the root
- `demo/` — Astro `output: 'server'` demo, previewed through a Fastify server (`demo/server.mjs`)
- `demo-static/` — Astro `output: 'static'` demo, previewed with `astro preview`

Only the demos are listed in `pnpm-workspace.yaml`; the root package is implicitly part of the workspace. Both demos consume it via `workspace:*` (pnpm symlinks them straight to the repo root), so changes to `src/` require a rebuild before the demos see them — which is why almost every demo script chains `npm run build` first.

## Commands

Run everything from the repo root:

```bash
pnpm run build          # tsup build of src/ into dist/
pnpm run test           # vitest run (always with coverage)
pnpm run test:watch     # vitest in watch mode
pnpm run lint           # eslint with cache
pnpm run format         # prettier --write
pnpm run check          # format + lint

pnpm run dev            # build + build & preview the SSR demo (Fastify, port 4321)
pnpm run dev:static     # build + build & preview the static demo

pnpm bump               # check + bumpp: version, commit, tag, push to origin
pnpm release            # push the tag to gh, once the commit has landed there
```

Single test: `pnpm exec vitest run test/astro-sw.test.ts` (or `-t '<name>'` to filter by test name).

Because the root is the package, adding a dependency to it needs the explicit workspace-root flag: `pnpm add -Dw <pkg>`. Without `-w`, pnpm refuses with `ERR_PNPM_ADDING_TO_ROOT`.

### Tests and coverage

`vitest.config.mjs` scopes the run to `test/**/*.test.ts` (the demo workspaces are built, not unit tested) and has coverage **enabled by default** — every `pnpm run test`, including the one in the `pre-commit` hook, writes a v8 `html` + `text` report to the gitignored `coverage/`.

`test/astro-sw.test.ts` drives the integration's hooks directly with fixture Astro build output, with `node:fs/promises` and `esbuild` mocked, so nothing touches the disk. Assertions about the asset list read back the `const __assets = […]` line the integration writes into the temp entry, since that string is the actual contract with the user's service worker. Fixtures are coupled to two things the integration derives from the cwd: the service worker path is resolved against it, and public files are mapped relative to `<cwd>/dist/`.

`src/astro-sw.ts` is fully covered by line. The presets are not covered at all — they are unwired (see below), so the repo-wide total sits near 55%. Barrel and type-only files are excluded from the report.

### Releasing

A release is **two commands, not one**, because bumping the version and publishing it are two decisions:

1. `pnpm bump` — runs `release:check` (build, lint, test, then build **both** demos, since static and server outputs collect assets differently), then `bumpp`: bumps the version, commits `chore: release vX.Y.Z`, tags `vX.Y.Z`, and pushes to `origin` (git.ayo.run) itself.
2. The release commit reaches `gh`'s `main` the same way every other commit does. Nothing is pushed there directly.
3. `pnpm release` — `scripts/release.js`, which pushes the tag to `gh` and then, best-effort, to `sh`.

Step 3 refuses unless the tagged commit is an ancestor of `gh/main`. That guard is load-bearing rather than defensive: a branch ruleset protects `refs/heads/*` and nothing protects `refs/tags/*`, so a tag pointing at a commit `main` cannot reach would push without complaint and the release workflow would publish from it. It is also the only thing in the chain that notices a pull request that was squash-merged instead of merged — squashing rewrites the commit and strands the tag on one that no longer exists.

The script derives the tag from `package.json` rather than `git describe`, so it cannot drift from the version the release workflow checks it against.

**Nothing is published from a laptop.** The `v*` tag landing on `gh` triggers `.github/workflows/release.yml`, which publishes to npm via **trusted publishing** (OIDC, `id-token: write`) — no npm token exists anywhere, and the release carries provenance. The workflow refuses to publish if the tag and `package.json` version disagree, and routes prerelease versions to their own dist-tag (`1.1.0-beta.1` → `beta`) so `latest` keeps pointing at the newest stable.

`package.json` `repository.url` points at the **GitHub mirror**, not at `origin` (git.ayo.run), even though git.ayo.run is the repo of record. This is load-bearing: npm validates the provenance attestation against that field, and publishing fails with `E422 ... expected to match "https://github.com/ayo-run/astro-sw" from provenance` if it points anywhere else. Do not "correct" it back.

There is deliberately no manual publish script. Publishing by hand produces a release without provenance, and fails outright once npm's "require trusted publishing" setting is enabled for the package.

`prepare` runs `husky && npm run build`, and the husky `pre-commit` hook runs lint + test. The build belongs in `prepare`, not `postinstall`: because the repo root *is* the published package, a `postinstall` script ships in the tarball and runs in every consumer's `node_modules` — where neither `src/` nor `tsup` exists, so `npm i @ayco/astro-sw` aborts with `tsup: not found`. `prepare` runs on a local `pnpm install` here but never for a dependency installed from the registry, so it gives local dev the same build without the blast radius. `post-commit` pushes to `sh` automatically — expect commits to be pushed to that public remote as a side effect of committing. It deliberately does **not** push to `gh`: `gh/main` is what step 3 checks the release tag against, so a hook putting commits there on its own would defeat that check.

## Architecture

`src/astro-sw.ts` is essentially the whole integration; everything else is supporting types/presets. It is a single `AstroIntegration` using four hooks:

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

`src/presets/` exports `staleWhileRevalidate()` and `deleteOldCaches()` as `AstroServiceWorkerPreset` objects (`install`/`activate`/`fetch` handlers). They are **not shipped**. `src/presets/` is unbuilt WIP source: it is not a `tsup` entry, there is no `./presets` subpath in `exports`, `dist/presets/` no longer exists, and `AstroServiceWorkerConfig` has no `presets` field. Nothing in the published package can reach them, which is why `SECURITY.md` no longer carries a known-gap entry for their unsafe caching defaults — those defaults are still unsafe, and must be fixed before any of this is wired up.

Wiring them up means reversing all of that: add the `tsup` entries back, re-add the `exports` subpaths, restore the config field, consume it in `astro-sw.ts`, and restore the `SECURITY.md` entry until the defaults are fixed. Until then nothing in the integration should reference presets, so an unused-variable error is the correct signal rather than something to silence with a log. Both demos have the preset import commented out. Same for `AstroServiceWorkerConfig.experimental.strategy` and `customRoutes`: typed but unimplemented.

### eslint globals export

`@ayco/astro-sw/globals` (`src/eslint/globals.ts`) exports `{__prefix, __version, __assets}` as read-only globals so consumers' `no-undef` doesn't fire on injected variables. This repo's own `eslint.config.mjs` imports it by package name, which resolves back to the root's own `dist/` — meaning **linting requires the package to be built first**.

## Conventions

- Prettier: no semicolons, single quotes, es5 trailing commas, 2-space tabs. HTML/MD/CSS/YAML are prettier-ignored.
- ESM only (`"type": "module"`), Node >= 18, Astro `^6` peer dep.
- The root `README.md` is the one published to npm — edit it directly (it is no longer copied anywhere at build time).
