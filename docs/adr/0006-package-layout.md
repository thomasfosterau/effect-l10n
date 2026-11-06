# 0006. The package layout

- **Status:** Superseded in part by [0007](0007-single-core-package.md) (the package names, the one-package-per-role split and the scope; the dependency direction and the package template stand)
- **Date:** 2026-10-29
- **Issue:** [#14](https://github.com/thomasfosterau/effect-l10n/issues/14), [#15](https://github.com/thomasfosterau/effect-l10n/issues/15)

## Context

The roadmap spans an MF2 engine, an authoring API, a compiler, several platform targets, interchange formats, a CLI and bundler plugins. Build-time Effect code must never leak into runtime output (ADR 0003), and each target should be installable on its own.

## Decision

One pnpm workspace, one npm package per role, all under the `@effect-l10n` scope:

| Package                                      | Role                                                               | Runs at                |
| -------------------------------------------- | ------------------------------------------------------------------ | ---------------------- |
| `@effect-l10n/messageformat`                 | MF2 data model, parser, validation, inference, reference formatter | build                  |
| `@effect-l10n/core`                          | Locales, `Message.make`, catalogs, translations, `defineConfig`    | authoring / build      |
| `@effect-l10n/compiler`                      | Compiler service, `Target` interface, IR, lowering, diagnostics    | build                  |
| `@effect-l10n/target-web`                    | JS/TS emitter plus the generated runtime                           | build (emits plain JS) |
| `@effect-l10n/target-apple`                  | `.xcstrings` / `.strings` / `.stringsdict` + Swift                 | build                  |
| `@effect-l10n/target-android`                | `strings.xml` + Kotlin                                             | build                  |
| `@effect-l10n/interchange`                   | XLIFF 2 / JSON / MF1 import                                        | build                  |
| `@effect-l10n/cli`                           | the `effect-l10n` binary                                           | build                  |
| `@effect-l10n/vite`, `@effect-l10n/unplugin` | bundler integration                                                | build                  |
| `@effect-l10n/testing` (private)             | shared test helpers (golden-file trees); never published           | test                   |

Dependencies point one way: `messageformat` ← `core` ← `compiler` ← targets / `interchange` ← `cli` / bundler plugins. `.fallowrc.json` encodes this as boundary zones, so an import against the arrow fails `fallow`.

Every package follows the template in [AGENTS.md](../../AGENTS.md#packages): `src/index.ts` as its entry, a `vite.config.ts` that instantiates the shared `vite.package.ts`, `effect` as a peer, and `"private": true` until it ships its first public API. A package is created when its milestone starts; `messageformat`, `core`, `compiler` and `testing` exist from M0. Example projects (`examples/web`, `examples/ios`, `examples/android`) join the workspace as private packages with the targets that need them.

## Consequences

- A web application depends on `target-web`'s output, not on the compiler: none of the build-time packages reach its bundle.
- Each target is versioned and installed on its own; Changesets releases only the packages that changed.
- Adding a package means a row here and in AGENTS.md, its zone in `.fallowrc.json`, and its `check` edge on the root `check` task.
- The `@effect-l10n` npm scope must be owned before the first publish (an owner action; see [PUBLISHING.md](../../PUBLISHING.md)).
