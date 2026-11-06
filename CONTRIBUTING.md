# Contributing

effect-l10n is maintained by Thomas Foster, with a workflow meant to suit both people and coding agents. The conventions every change follows are in [AGENTS.md](AGENTS.md) (also read by agents as `CLAUDE.md`); the design decisions are the [ADRs](docs/adr/README.md); the release pipeline is [PUBLISHING.md](PUBLISHING.md).

## Setup

Open in a Codespace or Dev Container: `.devcontainer/` provisions it with the same hook as agent sessions. The `Dev Container` workflow (`.github/workflows/devcontainer.yml`) builds it in CI whenever its inputs change; to try a change locally, `pnpm dlx @devcontainers/cli@0.89.0 up --workspace-folder .` (needs Docker).

You need **Node ≥ 22.18** (`.node-version` names the major CI's floor runs; CI also runs the current LTS, 24) and **pnpm 12.15.0**, the version `packageManager` in `package.json` pins.

1. Install pnpm. With Node 22 or 24, `corepack enable` makes `pnpm` resolve to the pinned version on first use. Corepack cannot fetch pnpm 12 in some environments (an old Corepack signing key, or no Corepack at all on Node ≥ 25); then run pnpm through npm instead: `npm install -g pnpm@12.15.0`, or one-off `npx pnpm@12.15.0 install`.
2. `pnpm install` from the repo root. Its `prepare` step installs the Vite+ git hooks and patches the native `tsc` and oxlint with the Effect language service (`effect-tsgo patch`); do not install with `--ignore-scripts`, or the type gate runs without the Effect diagnostics.
3. Run the gates once to see a green tree:

   ```sh
   pnpm exec vp check          # format + lint (type-aware)
   pnpm exec vp run check      # the type gate
   pnpm exec vp run -r test:unit
   pnpm exec vp run -r build
   ```

   `vp` is [Vite+](https://viteplus.dev), installed as a dev dependency: `pnpm exec vp …` always works, and a global Vite+ install (or `node_modules/.bin` on your `PATH`) lets you drop the `pnpm exec`.

### Editor

Use the **workspace TypeScript** (VS Code: _TypeScript: Select TypeScript Version → Use Workspace Version_), so the editor loads `node_modules/typescript` (TypeScript 6, the JS API) with the `@effect/language-service` plugin from `tsconfig.base.json`. The Effect diagnostics, quick fixes and refactors then match what `vp run check` reports. The [Oxc extension](https://marketplace.visualstudio.com/items?itemName=oxc.oxc-vscode) shows the lint and format results.

## Commands

```sh
vp check                                   # format + lint, the CI order (Oxfmt, then Oxlint)
vp check --fix                             # …applying fixes
vp fmt                                     # format only
vp lint                                    # lint only
vp run check                               # the type gate: every package's tsc, then the root configs
vp run --filter @thomasfosterau/effect-l10n check    # one package's type gate
vp run -r test:unit                        # every package's unit tests
vp test run src/some.test.ts               # one file (from inside the package)
vp test run -u                             # rewrite snapshots and golden files
vp run -r build                            # vp pack → every package's dist/
vp run -r check:package                    # publint + attw over each package's tarball
vp run test:coverage                       # one Istanbul map for fallow
vp exec fallow audit --base origin/trunk   # the change-set review (not a CI gate)
```

[AGENTS.md](AGENTS.md#verification) lists the full gate list a change must pass, in CI's order.

## Changes and pull requests

- Branch off `trunk`, rebase onto `origin/trunk` (never merge it in), and open the PR against `trunk`. PRs are squash-merged with a conventional prefix: `feat:`, `fix:`, `docs:`, `chore:`.
- **Changesets:** a change to a published package's behaviour carries one (`pnpm changeset`: pick the packages and the bump, write a user-facing summary, commit the file). Docs-, CI- and tooling-only changes need none, and neither does a package that is still `private`. CI's `changeset status` job warns when one looks missing.
- **Git hooks:** pre-commit runs `vp staged` (format with fixes, then lint without fixes, on the staged files). There is no pre-push hook: run the gates yourself.
- **Lint findings are fixed in code**, never silenced with a disable comment; a rule is relaxed only in `vite.config.ts`, with a comment giving the reason.
- **Versions live in the catalog** (`pnpm-workspace.yaml`), never in a `package.json`; commit the regenerated `pnpm-lock.yaml` with any catalog change.
- A new package follows the template in [AGENTS.md](AGENTS.md#packages); a new design decision gets an [ADR](docs/adr/README.md).

## Testing

Tests sit beside the code as `src/**/*.test.ts` and import from `vite-plus/test`, or from `@effect/vitest` for Effect code (`it.effect`, `it.layer`, `it.prop`, `assert`). The conventions below apply as the milestones that need them land.

- **Unit tests** cover each module's behaviour, including its typed failures: assert on the tagged error, not on a message.
- **Property tests** use `@effect/vitest`'s `it.prop`, which draws inputs from `Schema`s (or Effect `Arbitrary`s) and shrinks a failing case. Every parser and serialiser gets a round-trip property (`parse(serialise(x))` equals `x`); [`packages/testing/src/golden.test.ts`](packages/testing/src/golden.test.ts) shows the shape.
- **Golden-file tests** compare everything a target emits for a fixture project with a committed tree. Call `expectGoldenTree(tree, directory)` from `@thomasfosterau/effect-l10n-testing` (a private workspace package: add `"@thomasfosterau/effect-l10n-testing": "workspace:*"` to the package's `devDependencies`) inside an `it.effect` that provides its `layer`. Snapshots live under the test's `__golden__/<case>/` directory, which the formatter leaves alone so the bytes stay the target's. `vp test run -u` rewrites them after an intended change; review the diff like code. A committed file the target stops emitting fails the test until you delete it. The stub-target test in `packages/testing` is the worked example; real targets reuse it from M3 (#32) on.
- **MF2 conformance** (M1): the unicode-org/message-format-wg `test/` JSON suites are vendored into `packages/core/src/messageformat`, pinned to one spec release with its version and source commit recorded beside them, and run as data-driven tests by the parser, validator and formatter. Updating them is its own PR.
- **Example projects** (`examples/web`, `examples/ios`, `examples/android`) join the workspace as private packages with the targets that need them (M4–M6), and double as the golden fixtures and the documentation's samples.
- **Native CI jobs** are reserved for M5 / M6: a macOS job that builds the generated Swift and an Android job that runs Gradle against the generated Kotlin, each triggered only when its target package or examples change (a `paths` filter).

## CI

[ci.yml](.github/workflows/ci.yml) runs the gates on Node 22 and 24, plus the advisory `changeset status` job on PRs. [release.yml](.github/workflows/release.yml) runs Changesets on `trunk` ([PUBLISHING.md](PUBLISHING.md)).
