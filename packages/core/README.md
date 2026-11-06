# @thomasfosterau/effect-l10n

The core of effect-l10n: everything that is platform-neutral and needs no dependency beyond `effect`, as one package with a subpath export per layer.

| Entry                                       | Contents                                                                                                                                                                                                         | Milestone                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `@thomasfosterau/effect-l10n/messageformat` | The Unicode MessageFormat 2 engine: the data model as an Effect `Schema`, the parser with source spans and tagged errors, semantic validation, type-level parameter inference and the reference formatter        | M1 ([#4](https://github.com/thomasfosterau/effect-l10n/issues/4)) |
| `@thomasfosterau/effect-l10n`               | The authoring API: the locale model (BCP 47 tags, negotiation, fallback chains), `Message.make`, catalogs and stable message IDs, translations validated against the source locale, and the typed `defineConfig` | M2 ([#5](https://github.com/thomasfosterau/effect-l10n/issues/5)) |
| `@thomasfosterau/effect-l10n/compiler`      | The `Compiler` service, the `Target` plugin interface, the platform-agnostic IR and its capability-aware lowering passes, structured diagnostics and incremental builds                                          | M3 ([#6](https://github.com/thomasfosterau/effect-l10n/issues/6)) |

Imports point one way, `messageformat` ← the root entry ← `compiler`; platform targets, the CLI and bundler plugins are separate `@thomasfosterau/effect-l10n-<name>` packages built on top. See [ADR 0007](../../docs/adr/0007-single-core-package.md).

> **Status:** scaffolded ahead of milestones M1–M3; nothing is exported or published yet.

## License

[MIT](../../LICENSE)
