# AGENTS.md

`CLAUDE.md` is a symlink to this file. This repo publishes the `@thomasfosterau/effect-l10n` packages: an experimental Effect library and CLI for internationalisation (i18n), globalisation (g11n) and localisation (l10n). It is a pnpm workspace on [Vite+](https://viteplus.dev) (`vp`), linted with Oxlint and the `@enfect/oxlint` Effect preset and audited with [fallow](https://fallow.tools). The default branch is `trunk`. Human setup (pnpm 12 without Corepack, the editor's language service) is in [CONTRIBUTING.md](CONTRIBUTING.md), the release pipeline in [PUBLISHING.md](PUBLISHING.md), and the design decisions in [docs/adr/](docs/adr/README.md).

## Packages

The layout is [ADR 0007](docs/adr/0007-single-core-package.md), which supersedes the package split of [ADR 0006](docs/adr/0006-package-layout.md); every design decision is an [ADR](docs/adr/README.md). **One core package**, `@thomasfosterau/effect-l10n`, holds everything platform-neutral that needs no dependency beyond `effect`, one `exports` subpath per layer. **A separate package exists only for platform-specific code or code that brings a dependency** (targets, the CLI, bundler plugins, test helpers): it is `@thomasfosterau/effect-l10n-<name>` in `packages/<name>`, created as its milestone starts.

| Package / entry                             | Source                             | Milestone                          |
| ------------------------------------------- | ---------------------------------- | ---------------------------------- |
| `@thomasfosterau/effect-l10n/messageformat` | `packages/core/src/messageformat/` | M1 (#4)                            |
| `@thomasfosterau/effect-l10n`               | `packages/core/src/*.ts`           | M2 (#5)                            |
| `@thomasfosterau/effect-l10n/compiler`      | `packages/core/src/compiler/`      | M3 (#6)                            |
| `@thomasfosterau/effect-l10n-testing`       | `packages/testing`                 | M0 (#18), private, never published |

Imports point one way, `messageformat` ← the root entry ← `compiler` ← targets / interchange ← `cli` / bundler plugins. Inside `packages/core` that is enforced by module boundaries, the zones in `.fallowrc.json`'s `boundaries` (`boundaries.coverage.requireAllFiles` puts every source file in a zone); a subpath imports another through a relative path, never through the package's own name. Any package's tests may use `@thomasfosterau/effect-l10n-testing` (golden-file trees; the test strategy is in [CONTRIBUTING.md](CONTRIBUTING.md#testing)).

A new **core layer** (platform-neutral, no new dependency) is a directory under `packages/core/src/` with an `index.ts` entry, its subpath in `packages/core/package.json`'s `exports` (`dist/<layer>/index.js` / `.d.ts`), its `vp pack` entry in `packages/core/vite.config.ts`, and its zone and rule in `.fallowrc.json`.

A new **separate package** copies `packages/testing`'s shape, with the published metadata of `packages/core`:

- `package.json`: name `@thomasfosterau/effect-l10n-<name>`, `"private": true` (until its first public API), `"version": "0.0.0"`, `"type": "module"`, `"sideEffects": false`, `exports` pointing at `dist/index.js` / `dist/index.d.ts`, the shared metadata (`repository` naming `thomasfosterau/effect-l10n` with its `directory`, `homepage`, `bugs`, `keywords`, `engines`), `effect: "catalog:peers"` as a peer (or its own named peers catalog, when its dependencies force a higher `effect`) and `effect: "catalog:"` as a dev dependency. A workspace sibling it imports (the core package included) is a `workspace:^` dependency.
- `vite.config.ts`: `export default packageConfig()` from the root `vite.package.ts`, which defines its `check`, `build` and `test:unit` tasks (each with a build edge on its workspace dependencies) and its `vp pack` and Vitest settings (`packageConfig({ ... })`, entries by output path, for more than one entry).
- `tsconfig.json` extending `../../tsconfig.base.json` over `src` and `vite.config.ts`; `src/index.ts` as the entry, tests beside the code as `src/**/*.test.ts`; a `README.md`.
- Its row in the table above, its `#check` edge on the root `check` task (`vite.config.ts`), and its zone and rule in `.fallowrc.json`'s `boundaries`.

## Common pitfalls

- **Never edit a version in a `package.json`.** Versions live in the `pnpm-workspace.yaml` catalog (`catalogMode: strict`). After editing it, run `pnpm install` and commit `pnpm-lock.yaml`, or CI fails with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. `vite-plus`, `vite`, `vitest`, `@vitest/*`, `@effect/tsgo` and `@typescript/native` move together (`@effect/tsgo` hard-errors at install on a `tsc` or oxlint it does not support: read its catalog comment before bumping any of them); Dependabot's `toolchain` group bumps them as one PR (its only other group is `effect`, the Effect 4 line; everything else, `@enfect/oxlint` included, comes as its own PR), except the `vite` npm alias (`npm:@voidzero-dev/vite-plus-core@<v>`, equal to `vite-plus`), which Dependabot cannot bump: set it by hand in that PR, or run `pnpm exec vp migrate` (then drop any `minimumReleaseAgeExclude` entries it adds). `.github/dependabot.yml`'s header lists the hand moves. `minimumReleaseAge` holds new versions for 8 hours (480 minutes); Dependabot's cooldown is 1 day.
- **`dist/` is the product.** Each package is a `vp pack` (tsdown) library; `exports` points at `dist/`.
- **Every package is `"private": true` until it ships a public API.** Changesets ignores private packages and `pnpm -r publish` skips them, so the Release job versions and publishes nothing while the workspace is scaffolding (an empty `0.0.0` publish only 404s: npm has no trusted publisher for an unpublished name). The PR that gives a package its first real API removes `private` and adds the changeset that releases it as `0.1.0` ([PUBLISHING.md](PUBLISHING.md)).
- **`effect` is a peer, never a dependency.** A package that imports it declares `effect: "catalog:peers"` under `peerDependencies` and `effect: "catalog:"` under `devDependencies`; the `effect` override keeps one copy in the tree, because two break `Context` / `Layer` / `Schema` identity.
- **TypeScript 6 and 7 side by side.** `typescript` is the TS6 JS compiler (`npm:@typescript/typescript6`, bin `tsc6`) for JS-API consumers: the editor's tsserver with the `@effect/language-service` plugin, and `vp pack`'s declaration bundler. `@typescript/native` is TS7 (bin `tsc`), which the `check` tasks run. The root `prepare` (`effect-tsgo patch --typescript --oxlint`) patches that `tsc` and oxlint-tsgolint with the Effect language service, so the type gate and type-aware lint report Effect diagnostics (a floating `Effect`, a missing `yield*`) as errors. An install with `--ignore-scripts` leaves them unpatched.

## Conventions

- Tests import from `vite-plus/test`, never `vitest` (`vite-plus/prefer-vite-plus-imports` enforces it); an Effect test uses `@effect/vitest`'s `it.effect` and `assert`.
- `exactOptionalPropertyTypes` is on: spell an optional a caller may forward `undefined` for as `?: T | undefined`.
- Lint findings are fixed in code, never suppressed with a disable comment; a rule is relaxed only in `vite.config.ts`, with a comment giving the reason.

## Commands

- `pnpm install` — dependencies, the `@effect/tsgo` patch and the Vite+ git hooks (`prepare` runs `vp config && effect-tsgo patch --typescript --oxlint`; pre-commit runs `vp staged`: format with fixes, then lint without, so no type-aware autofix lands unverified). No pre-push hook.
- `vp check` — format + lint (Oxfmt + Oxlint: `@enfect/oxlint`'s `recommended` Effect rules, `@effect/tsgo`'s preset (the language service's diagnostics as `effecttsgo/*` rules), Oxlint's `correctness`, `suspicious` and `perf` categories over the `typescript`, `unicorn`, `oxc`, `import`, `promise`, `vitest` and `jsdoc` plugins, and `vite-plus/prefer-vite-plus-imports`). Lint is type-aware through oxlint-tsgolint (`typeAware` + `typeCheck`), which reads each file's nearest `tsconfig.json`. `vp run check` — the type gate (the Effect-patched native `tsc --noEmit` per package, then the root configs); the issue tracker's `pnpm typecheck` is this task. They are different commands.
- `vp run -r test:unit` — unit tests.
- `vp run -r build` — `vp pack` → every package's `dist/`.
- `vp run -r check:package` — publint and `attw --pack` (ESM-only profile) over what each package would publish.
- `vp run test:coverage` — every package's suite under one Istanbul map at `coverage/coverage-final.json`, which `fallow audit` reads for per-function CRAP scores.
- `pnpm changeset` — add a changeset (`changeset status --since origin/trunk` shows what it would release).

Invoke everything through `vp` (`vp exec` instead of `npx`; `vp run <task>` instead of bare `pnpm`). The sanctioned non-`vp` invocations: `pnpm install` (`--frozen-lockfile` in CI), `pnpm audit`, and `pnpm changeset` / the release scripts.

## Verification

Before you report work as done, run the gates below in order and quote each command with its final pass/fail. If a gate can't run here, say which and why in the PR body; never imply it ran.

1. From a clean install, which is what CI sees: `rm -rf node_modules packages/*/node_modules packages/*/dist coverage && pnpm install --frozen-lockfile`.
2. `vp check`
3. `vp run check`
4. `vp run -r test:unit`
5. `vp run -r build`
6. `vp run -r check:package` (publint + attw over each package's packed tarball)
7. `pnpm audit --audit-level high` (network)
8. `vp run test:coverage`, then `vp exec fallow audit --format json --quiet --explain --gate-marker agent --base origin/trunk` (the fallow gate below; not a CI step).

Steps 2–7 are CI's `ci` job, in its order, on Node 22 and 24 ([ci.yml](.github/workflows/ci.yml)). Every workflow defaults to `permissions: {}`, pins each action to a commit SHA, checks out without persisted credentials (except the Release job, whose Changesets step pushes), and never runs the Release job for Dependabot; the `ci` workflow's advisory `changeset status` job only annotates; CI needs no secret, so Dependabot PRs run it safely. `uvx zizmor --offline .github` audits the workflows.

## Branches and pull requests

- Branch off `trunk`; PR against `trunk`; squash-merge with a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`). Rebase onto `origin/trunk` before opening or updating a PR; never merge `trunk` into your branch.
- Every change to a published package's behaviour carries a changeset (`pnpm changeset`); docs-, CI- and tooling-only changes need none. Never publish or version by hand: the Release workflow opens the version PR (`chore: version packages`) and the owner merges it; publishing is npm trusted publishing (OIDC) from the protected `release` environment, with no `NPM_TOKEN` ([PUBLISHING.md](PUBLISHING.md)). A private package needs no changeset: Changesets ignores it until the PR that removes `private`.
- GitHub writes go to `thomasfosterau/effect-l10n` only.

## Effect

Never guess at an Effect API: read the installed package (`node_modules/effect/AGENTS.md` and `node_modules/effect/ai-docs/` first, then `node_modules/effect/dist/*.d.ts` and `node_modules/effect/src`). The pinned version is the `effect` entry in `pnpm-workspace.yaml`'s catalog; the published peer floor is under `catalogs.peers`. The `effect` peer is `^4.0.0`, decided per package: raise a package's range only when its own dependencies require it, in a named catalog of its own whose comment names the dependency (the private testing package's `catalogs.platform-node-peers`, for `@effect/platform-node-shared`), never because our code wants a newer API.

- **Imports** are namespace imports of the owning module (`import * as Effect from "effect/Effect"`), never named imports from the `effect` barrel (`effect/no-barrel-imports`); `effect/Record` is `R` and `effect/String` is `Str` (`effect/prefer-namespace-imports`).
- **Functions returning an `Effect`** are `Effect.fn("name")(function* (...) { ... })` (traced) or `Effect.fnUntraced` on hot paths, not a function wrapping `Effect.gen`. Give `Effect.forEach` and friends an explicit `concurrency`.
- **Errors** are `Schema.TaggedError<Self>()(tag, fields)` classes, failed with `return yield* new MyError({ ... })`; never `throw`, never extend `Error`. A parser or validator reports source spans in its error fields (M1, [ADR 0002](docs/adr/0002-messageformat-2.md)).
- **Data** crossing a boundary (configs, translation files, interchange formats) is decoded with an Effect `Schema`, never `JSON.parse` plus a cast. A `Schema` is the single source of a model's type (`typeof X.Type`).
- **Services** are `Context.Service` classes with a `layer` (and a `layerTest` where a fake is useful); I/O goes through Effect's `FileSystem` / `Path` services, provided at the edge (the CLI, a test's `it.layer`), so library code stays platform-neutral.
- **Build time only** ([ADR 0003](docs/adr/0003-effect-at-build-time-only.md)): nothing a target emits for the web imports `effect`.

## Agent sessions

- The SessionStart hook (`.claude/hooks/session-start.sh`) installs the global Vite+ CLI at the catalog's `vite-plus` pin with the official installer (npm-provenance and SHA-512 checked; the session's network must allow `vite.plus` and `viteplus.dev`), links `vp` and `vpx` into `~/.local/bin` (the CLI lives under `$VP_HOME` when set, as in the Vite+ container image, else `~/.local/share/vite-plus`), runs `vp install --frozen-lockfile`, and repairs a broken bare `node`. Nothing else goes on PATH: the global `vp` delegates to each checkout's own `vite-plus` (worktrees included, after their own `vp install`), fallow runs as `vp exec fallow …`, and TypeScript scripts as `vpx <file>.ts`. If the installer can't run, `vp` falls back to this checkout's `node_modules` copy. It hydrates no secrets.
- A PreToolUse hook (`.claude/hooks/fallow-gate.sh`) blocks `git commit` / `git push` when `fallow audit --base origin/trunk` (run through `vp exec fallow`) fails, only in this checkout and its `.claude/worktrees/*`: from any other tree it runs none of that tree's tooling and skips the audit with a notice; it reads the coverage map on disk, so run `vp run test:coverage` first. A PostToolUse hook runs `vp fmt` on every source, JSON, CSS or Markdown file you write or edit.

---

## Fallow local gate

Before any `git commit` or `git push`, run `fallow audit --format json --quiet --explain --gate-marker agent --base origin/trunk`. If the verdict is `fail`, fix the reported findings before retrying. Treat JSON runtime errors like `{ "error": true, ... }` as non-blocking. Audit defaults to `gate=new-only`: only findings introduced by the current changeset affect the verdict.

## Fallow task map

| When the agent is about to...                                     | Run                                          |
| ----------------------------------------------------------------- | -------------------------------------------- |
| delete an "unused" export or file                                 | `fallow dead-code --trace <file>:<export>`   |
| delete an "unused" dependency                                     | `fallow dead-code --trace-dependency <name>` |
| commit or open a PR                                               | `fallow audit --base origin/trunk`           |
| check which architecture rules apply to a file before changing it | `fallow guard <files>`                       |
| understand a finding                                              | `fallow explain <issue-type>`                |
