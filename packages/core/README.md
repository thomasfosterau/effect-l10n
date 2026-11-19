# @thomasfosterau/effect-l10n

The core of [effect-l10n](https://github.com/thomasfosterau/effect-l10n): everything platform-neutral that needs no dependency beyond `effect`, one subpath export per layer.

> [!CAUTION]
> Experimental and pre-1.0; scaffolded ahead of milestones M1–M3, so nothing is exported or published yet.

| Entry                                       | Contents                                                                                                                                                            | Milestone |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `@thomasfosterau/effect-l10n/messageformat` | The Unicode MessageFormat 2 engine: data model as a `Schema`, parser with source spans and tagged errors, validation, parameter type inference, reference formatter | M1        |
| `@thomasfosterau/effect-l10n`               | The authoring API: locales (BCP 47, negotiation, fallback), `Message.make`, catalogs and message IDs, translations, `defineConfig`                                  | M2        |
| `@thomasfosterau/effect-l10n/compiler`      | The `Compiler` service, the `Target` plugin interface, the IR and its lowering passes, diagnostics                                                                  | M3        |

Imports point one way: `messageformat` ← root ← `compiler` ([ADR 0007](https://github.com/thomasfosterau/effect-l10n/blob/trunk/docs/adr/0007-single-core-package.md)).

License: [MIT](https://github.com/thomasfosterau/effect-l10n/blob/trunk/LICENSE.md)
