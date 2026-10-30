# AGENTS.md

`CLAUDE.md` is a symlink to this file. This repo publishes the `effect-l10n` packages: an experimental Effect library and CLI for internationalisation (i18n), globalisation (g11n) and localisation (l10n). It is a pnpm workspace on [Vite+](https://viteplus.dev) (`vp`), linted with Oxlint and the `@enfect/oxlint` Effect preset and audited with [fallow](https://fallow.tools). The default branch is `main`.

| Package             | Directory       | Entries |
| ------------------- | --------------- | ------- |
| `@effect-l10n/core` | `packages/core` | `.`     |

A new package adds a row here, its own `vite.config.ts` with `check` / `build` / `test:unit` tasks, a `#check` edge on the root `check` task (`vite.config.ts`), and its entry points in `.fallowrc.json`.

## Common pitfalls

- **Never edit a version in a `package.json`.** Versions live in the `pnpm-workspace.yaml` catalog (`catalogMode: strict`). After editing it, run `pnpm install` and commit `pnpm-lock.yaml`, or CI fails with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. `vite-plus`, `vite`, `vitest`, `@vitest/*` and `@enfect/oxlint` move together; Dependabot's `toolchain` group bumps them as one PR, except the `vite` npm alias (`npm:@voidzero-dev/vite-plus-core@<v>`, equal to `vite-plus`), which Dependabot cannot bump: set it by hand in that PR, or run `pnpm exec vp migrate` (then drop any `minimumReleaseAgeExclude` entries it adds). `.github/dependabot.yml`'s header lists the hand moves. `minimumReleaseAge` holds new versions for 8 hours (480 minutes); Dependabot's cooldown is 1 day.
- **`dist/` is the product.** Each package is a `vp pack` (tsdown) library; `exports` points at `dist/`.
- **`effect` will be a peer, never a dependency,** once a package imports it: two copies break `Context` / `Layer` / `Schema` identity.

## Conventions

- Tests import from `vite-plus/test`, never `vitest` (`vite-plus/prefer-vite-plus-imports` enforces it).
- `exactOptionalPropertyTypes` is on: spell an optional a caller may forward `undefined` for as `?: T | undefined`.
- Lint findings are fixed in code, never suppressed with a disable comment; a rule is relaxed only in `vite.config.ts`, with a comment giving the reason.

## Commands

- `pnpm install` — dependencies plus the Vite+ git hooks (`prepare` runs `vp config`; pre-commit runs `vp staged`: format with fixes, then lint without, so no type-aware autofix lands unverified). No pre-push hook.
- `vp check` — format + lint (Oxfmt + Oxlint: `@enfect/oxlint`'s `recommended` Effect rules, Oxlint's `correctness`, `suspicious` and `perf` categories over the `typescript`, `unicorn`, `oxc`, `import`, `promise`, `vitest` and `jsdoc` plugins, and `vite-plus/prefer-vite-plus-imports`). Lint is type-aware through oxlint-tsgolint (`typeAware` + `typeCheck`), which reads each file's nearest `tsconfig.json`. `vp run check` — the type gate (`tsc --noEmit` per package, then the root configs). They are different commands.
- `vp run -r test:unit` — unit tests.
- `vp run -r build` — `vp pack` → every package's `dist/`.
- `vp run test:coverage` — every package's suite under one Istanbul map at `coverage/coverage-final.json`, which `fallow audit` reads for per-function CRAP scores.
- `pnpm changeset` — add a changeset.

Invoke everything through `vp` (`vp exec` instead of `npx`; `vp run <task>` instead of bare `pnpm`). The sanctioned non-`vp` invocations: `pnpm install` (`--frozen-lockfile` in CI), `pnpm audit`, and `pnpm changeset` / the release scripts.

## Verification

Before you report work as done, run the gates below in order and quote each command with its final pass/fail. If a gate can't run here, say which and why in the PR body; never imply it ran.

1. From a clean install, which is what CI sees: `rm -rf node_modules packages/*/node_modules packages/*/dist coverage && pnpm install --frozen-lockfile`.
2. `vp check`
3. `vp run check`
4. `vp run -r test:unit`
5. `vp run -r build`
6. `pnpm audit --audit-level high` (network)
7. `vp run test:coverage`, then `fallow audit --format json --quiet --explain --gate-marker agent --base origin/main` (the fallow gate below; not a CI step).

Steps 2–6 are CI's `ci` job, in its order, on Node 22 and 24 ([ci.yml](.github/workflows/ci.yml)). Every workflow defaults to `permissions: {}`, pins each action to a commit SHA, checks out without persisted credentials (except the Release job, whose Changesets step pushes), and never runs the Release job for Dependabot; CI needs no secret, so Dependabot PRs run it safely. `uvx zizmor --offline .github` audits the workflows.

## Branches and pull requests

- Branch off `main`; PR against `main`; squash-merge with a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`). Rebase onto `origin/main` before opening or updating a PR; never merge `main` into your branch.
- Every change to a published package's behaviour carries a changeset (`pnpm changeset`); docs-, CI- and tooling-only changes need none. Never publish or version by hand: the Release workflow opens the version PR (`chore: version packages`) and the owner merges it.
- GitHub writes go to `thomasfosterau/effect-l10n` only.

## Effect

Never guess at an Effect API: read the installed package (`node_modules/effect/dist/*.d.ts`, `node_modules/effect/src`, and `node_modules/effect/AGENTS.md` / `ai-docs/`). Tagged errors are `Schema.TaggedError<Self>()(tag, fields)` classes.

## Agent sessions

- The SessionStart hook (`.claude/hooks/session-start.sh`) installs dependencies against the lockfile and puts `vp` (a re-exec shim that prefers the nearest worktree's `node_modules`) and `fallow` on PATH for non-interactive shells. It hydrates no secrets.
- A PreToolUse hook (`.claude/hooks/fallow-gate.sh`) blocks `git commit` / `git push` when `fallow audit --base origin/main` fails; it reads the coverage map on disk, so run `vp run test:coverage` first. A PostToolUse hook runs `vp fmt` on every source, JSON, CSS or Markdown file you write or edit.
- `.claude/settings.json` enables the `@enfect/claude` plugin (Effect guidance, skills and post-write pattern checks), pinned by `ref` to a reviewed `mpsuesser/enfect` commit.

---

## Fallow local gate

Before any `git commit` or `git push`, run `fallow audit --format json --quiet --explain --gate-marker agent --base origin/main`. If the verdict is `fail`, fix the reported findings before retrying. Treat JSON runtime errors like `{ "error": true, ... }` as non-blocking. Audit defaults to `gate=new-only`: only findings introduced by the current changeset affect the verdict.

## Fallow task map

| When the agent is about to...                                     | Run                                          |
| ----------------------------------------------------------------- | -------------------------------------------- |
| delete an "unused" export or file                                 | `fallow dead-code --trace <file>:<export>`   |
| delete an "unused" dependency                                     | `fallow dead-code --trace-dependency <name>` |
| commit or open a PR                                               | `fallow audit --base origin/main`            |
| check which architecture rules apply to a file before changing it | `fallow guard <files>`                       |
| understand a finding                                              | `fallow explain <issue-type>`                |
