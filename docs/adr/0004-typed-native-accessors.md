# 0004. Typed native accessors alongside the resource files

- **Status:** Accepted
- **Date:** 2026-10-29
- **Issue:** [#2](https://github.com/thomasfosterau/effect-l10n/issues/2), [#14](https://github.com/thomasfosterau/effect-l10n/issues/14)

## Context

Native platforms already have resource formats their tooling understands: String Catalogs (`.xcstrings`) and `.strings` / `.stringsdict` on Apple, `strings.xml` with `<plurals>` on Android. Emitting only those keeps Xcode, Android Studio and their TMS integrations working, but callers then look messages up by string key and pass arguments positionally, which loses the typing ADR 0001 provides.

## Decision

Each native target emits **the platform's own resource files plus generated typed accessors**: Swift for Apple, Kotlin for Android (View and Compose). Accessors are functions named after the message with typed parameters, which read the resources through the platform API. Each output is **toggleable per target**, so a project can emit resources only.

## Consequences

- Platform tooling (Xcode's catalog editor, Android lint, existing TMS connectors) keeps working on the resource files.
- A renamed message or parameter breaks the native build, as it breaks the TypeScript one.
- The targets need native CI jobs (Swift on macOS, Gradle for Android) that build a sample app against the generated code (M5 / M6), run only when those packages change.
