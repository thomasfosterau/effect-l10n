# 0001. TS-first authoring with interchange round-trip

- **Status:** Accepted
- **Date:** 2026-10-29
- **Issue:** [#2](https://github.com/thomasfosterau/effect-l10n/issues/2), [#14](https://github.com/thomasfosterau/effect-l10n/issues/14)

## Context

Localisation toolkits pick a source of truth. JSON-first tools (i18next, Paraglide's inlang messages) are easy for translation-management systems (TMS) but give developers no types without a codegen step, and message parameters drift from the code that passes them. Code-first tools type well but tend to lock translators into the developer's toolchain.

## Decision

The **source locale is authored in TypeScript**: `Message.make(...)` declares each message, its MF2 pattern and its parameters as Effect `Schema`s, next to the code that uses it. Every **other locale round-trips through standard interchange formats** (XLIFF 2 and JSON of MF2 strings) for translators and TMS tools, and is imported back as data validated against the source locale.

## Consequences

- Message IDs, parameter names and parameter types come from one place and are checked by the compiler; a removed message or a renamed parameter is a type error, not a runtime blank.
- Translations are data, never code: importing a translation cannot run anything, and validation (missing, extra or ill-typed placeholders) reports against the source declarations.
- The interchange formats (M7) are first-class, not an afterthought: a translator never edits TypeScript.
- Translator metadata (descriptions, screenshots, max length) lives on `Message.make` and is exported with each message.
