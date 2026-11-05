# Architecture decision records

Each record states one decision: the context that forced it, the decision, and its consequences. They record the decisions agreed while planning the roadmap ([#2](https://github.com/thomasfosterau/effect-l10n/issues/2)); an issue comment or a newer ADR that supersedes one says so, and the old record is marked **Superseded** rather than deleted.

| ADR                                       | Decision                                                        | Status   |
| ----------------------------------------- | --------------------------------------------------------------- | -------- |
| [0001](0001-ts-first-authoring.md)        | TS-first authoring, with interchange round-trip for translators | Accepted |
| [0002](0002-messageformat-2.md)           | Unicode MessageFormat 2 is the message syntax                   | Accepted |
| [0003](0003-effect-at-build-time-only.md) | Effect only at build time; web output is plain JS               | Accepted |
| [0004](0004-typed-native-accessors.md)    | Typed native accessors (Swift / Kotlin) beside resource files   | Accepted |
| [0005](0005-web-locale-strategies.md)     | Paraglide-style locale strategies for the web runtime           | Accepted |
| [0006](0006-package-layout.md)            | The package layout                                              | Accepted |

## Writing a new one

Copy [the template](template.md) to the next free number (`NNNN-short-title.md`), add it to the table above, and land it in the PR that implements the decision (or before it, when the decision needs agreeing first).
