# Contributing

## Workflow

- Branch off `trunk` and open a pull request into `trunk`; never commit to `trunk` directly. Open a draft PR as soon as you start, and keep one PR per change, however large. Squash-merge with a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`). Rebase onto `origin/trunk` rather than merging it in.
- File an issue for anything you notice that is out of scope, and keep issue bodies evergreen: edit the body as understanding improves rather than appending comments.
- A new design decision gets an [ADR](adr/README.md).
- Dependabot keeps dependencies current. Its `toolchain` group needs hand edits on the same branch: run `vp dlx --package=vite-plus@<v> vp migrate --no-interactive` to re-pin `vite` and `vitest`, move `typescript` / `@typescript/native` only to a pair the new `@effect/tsgo` supports (see the catalog comment), and bump the devcontainer image tag to the new `vite-plus`.

## Toolchain

[Vite+](https://viteplus.dev) (`vp`) manages Node and pnpm and runs every task. `vp install` installs dependencies, the git hooks and, through `prepare`, the Effect-patched native `tsc` and oxlint; don't install with `--ignore-scripts`, or the type gate runs without the Effect diagnostics. In your editor, use the workspace TypeScript so the `@effect/language-service` plugin loads.

| Command                   | What it does                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `vp check`                | Format (Oxfmt) and lint (Oxlint with the Effect presets, type-aware)                   |
| `vp run check`            | Type gate: every package's `tsc`, then the root configs                                |
| `vp run -r test:unit`     | Unit tests; `vp test run -u` rewrites snapshots and golden files                       |
| `vp run -r build`         | `vp pack` → each package's `dist/`                                                     |
| `vp run -r check:package` | publint and attw over what each package would publish                                  |
| `vp run ci`               | Everything CI runs, in order (`pnpm audit` needs the network)                          |
| `vp run fallow:audit`     | Fallow on your change (dead code, boundaries, complexity); the pre-commit hook runs it |

The pre-commit hook runs `vp staged` (format, then lint) and then `vp run fallow:audit`, which writes the coverage map and fails on findings the change introduces against `origin/trunk`. [Fallow](https://docs.fallow.tools) is a guide, not dogma; trace before deleting "unused" code (`vp exec fallow dead-code --trace <file>:<export>`). Its boundary zones in `.fallowrc.json` enforce the import direction `messageformat` ← root ← `compiler` ← separate packages.

Every external version lives in the `pnpm-workspace.yaml` catalog; never edit one in a `package.json`. Commit the regenerated `pnpm-lock.yaml`.

## Coding guidelines

- **Effect.** Use Effect v4 idioms throughout and strongly prefer Effect's own modules (`Array`, `Option`, `Match`, `Schema`, `FileSystem`, …) over hand-rolled equivalents; convert existing code where practical. Exceptions: non-Effect APIs (adapt them at the edge) and hot paths where measured performance needs plain code. Read the installed package (`node_modules/effect`: `AGENTS.md`, `ai-docs/`, typings, source) rather than guessing an API.
  - Import modules as namespaces (`import * as Effect from "effect/Effect"`), never from the `effect` barrel; `effect/Record` is `R`, `effect/String` is `Str`.
  - Errors are `Schema.TaggedError` classes; data crossing a boundary is decoded with a `Schema`; I/O goes through `FileSystem` / `Path`, provided at the edge, so library code stays platform-neutral.
  - Nothing a target emits for the web imports `effect` ([ADR 0003](adr/0003-effect-at-build-time-only.md)). `effect` is always a peer, never a dependency.
- **Lint** findings are fixed in code; a rule is relaxed only in `vite.config.ts`, with its reason.
- **Comments.** A file-level comment only for real context, in under 50 words; doc comments where they add to IntelliSense (Effect's `@since` / `@category` tags); inline comments only for what the code can't say. No references to issues, PRs or history.
- **Tests** sit beside the code as `src/**/*.test.ts` and import from `vite-plus/test`, or `@effect/vitest` for Effect code (`it.effect`, `it.layer`, `it.prop`). Test logic and edge cases, not what the type system checks. Assert on tagged errors, not messages. Parsers and serialisers get a round-trip property (`it.prop`). Target output is checked with golden-file trees from `@thomasfosterau/effect-l10n-testing`.

## Adding a package

Platform-neutral code that needs only `effect` joins `packages/core` as a new subpath: a directory under `src/` with an `index.ts`, its `exports` entry, its `vp pack` entry in `packages/core/vite.config.ts`, and a zone and rule in `.fallowrc.json`. Code that is platform-specific or brings another dependency is a separate package, `@thomasfosterau/effect-l10n-<name>` in `packages/<name>` ([ADR 0007](adr/0007-single-core-package.md)): copy `packages/testing`'s shape with `packages/core`'s published metadata, keep it `"private": true` until its first public API, and add its row to the README, its `#check` edge on the root `check` task and its zone in `.fallowrc.json`.

## Before pushing

Run `vp run ci` (or `vp check`, `vp run check`, `vp run -r test:unit`, `vp run -r build`, `vp run -r check:package` one at a time). CI ([ci.yml](../.github/workflows/ci.yml)) runs `vp run ci` on Node `lts` and `latest` with no secrets. Workflows pin actions by exact tag, locked to commits by `.github/workflows/actions.lock`: run `gh actions-lock` after changing a `uses:`.

## Changesets

Every change to a published package's behaviour or its `.d.ts` (doc comments included, as a `patch`) needs a changeset: `vp exec changeset`. Docs-, CI- and tooling-only changes need none, and neither does a package that is still `private`. Never version or publish by hand: see [PUBLISHING.md](PUBLISHING.md).
