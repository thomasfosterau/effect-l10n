# 0007. One core package under the owner's scope

- **Status:** Accepted
- **Date:** 2026-11-06
- **Issue:** [#14](https://github.com/thomasfosterau/effect-l10n/issues/14), [#15](https://github.com/thomasfosterau/effect-l10n/issues/15)
- **Supersedes in part:** [0006](0006-package-layout.md) (the package names, the one-package-per-role split and the scope)

## Context

[ADR 0006](0006-package-layout.md) gave every role its own npm package under an `@effect-l10n` scope: `messageformat`, `core` and `compiler` were three packages although none of them is platform-specific or brings a dependency beyond `effect`. Three packages for one dependency-free stack cost three manifests, three type gates and three releases to keep in step, and a consumer has to install the right combination; the `@effect-l10n` scope would also have to be created and owned on npm. The owner's decision:

> Try to aim for a single core `@thomasfosterau/effect-l10n` package. Only have separate packages for platform-specific code and dependencies.

## Decision

**One core package.** `packages/core` is `@thomasfosterau/effect-l10n`. What were the `messageformat`, `core` and `compiler` packages are modules of it, each with its own `exports` subpath and `vp pack` entry:

| Entry                                       | Source                             | Role                                                               | Milestone |
| ------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------ | --------- |
| `@thomasfosterau/effect-l10n/messageformat` | `packages/core/src/messageformat/` | MF2 data model, parser, validation, inference, reference formatter | M1 (#4)   |
| `@thomasfosterau/effect-l10n`               | `packages/core/src/*.ts`           | Locales, `Message.make`, catalogs, translations, `defineConfig`    | M2 (#5)   |
| `@thomasfosterau/effect-l10n/compiler`      | `packages/core/src/compiler/`      | Compiler service, `Target` interface, IR, lowering, diagnostics    | M3 (#6)   |

The root entry's modules are the flat files directly under `src/` (Effect's own layout: one file per module); a layer that needs a directory of its own becomes another subpath.

**Module boundaries replace package boundaries.** The one-way direction of ADR 0006 still holds, `messageformat` ← root ← `compiler` ← separate packages, and `.fallowrc.json` encodes it as boundary zones over those three source trees (plus `testing`): an import against the arrow fails `fallow` as a `boundary-violation`. `boundaries.coverage.requireAllFiles` makes every source file belong to a zone, so a new directory under `src/` cannot slip past the rules unzoned; it gets a zone (usually a new subpath) or joins an existing one.

**The separate-package rule.** A separate package exists only for code that is **platform-specific** (it targets one platform or runtime, or needs a platform service such as Node's file system wired in) or that **brings a dependency** other than `effect`. Such a package is named `@thomasfosterau/effect-l10n-<name>` and lives in `packages/<name>`. From ADR 0006's list that is:

| Package                                                                    | Why separate                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `@thomasfosterau/effect-l10n-target-web`                                   | platform-specific (emits the web runtime)                                             |
| `@thomasfosterau/effect-l10n-target-apple`                                 | platform-specific                                                                     |
| `@thomasfosterau/effect-l10n-target-android`                               | platform-specific                                                                     |
| `@thomasfosterau/effect-l10n-cli`                                          | platform-specific (Node, the binary)                                                  |
| `@thomasfosterau/effect-l10n-vite`, `@thomasfosterau/effect-l10n-unplugin` | platform-specific, bundler dependencies                                               |
| `@thomasfosterau/effect-l10n-testing` (private)                            | test-only dependencies (`@effect/platform-node-shared`, `vite-plus`); never published |

Interchange (M7) and anything else not listed is decided by the same rule when its milestone starts: platform-neutral and dependency-free code joins the core package as a subpath (for example `./interchange`), and code that needs a dependency (an XML parser for XLIFF 2, a module loader for #31) or a platform layer (the Node layers of #36) is a separate package. A separate package sits above the core in the dependency direction and is its own boundary zone.

Everything else in ADR 0006 stands: the pnpm workspace, the package template in [AGENTS.md](../../AGENTS.md#packages), `effect` as a peer, `"private": true` until a first public API, a package created when its milestone starts, and the example projects as private workspace packages.

## Consequences

- A consumer installs one package for the whole build-time stack and imports the layer it needs by subpath; a web application still depends only on what `target-web` emits (ADR 0003), never on the core package.
- The core layers are versioned and released together: one changeset, one version, one `CHANGELOG.md`. A breaking change in one layer is a breaking change of the package.
- The publishing scope is the owner's own `@thomasfosterau` npm scope: there is no `@effect-l10n` organisation to create. `minimumReleaseAgeExclude` and Dependabot's cooldown exclusion already treat `@thomasfosterau/*` as first-party.
- Adding a core layer means a source directory, its `exports` subpath and `vp pack` entry in `packages/core`, and its zone and rule in `.fallowrc.json`. Adding a separate package also means a row in AGENTS.md, its zone, and its `check` edge on the root `check` task.
- ADRs 0002 and 0003 name the old packages; read `@effect-l10n/messageformat` there as `@thomasfosterau/effect-l10n/messageformat`.
