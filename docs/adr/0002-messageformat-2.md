# 0002. Unicode MessageFormat 2 as the message syntax

- **Status:** Accepted
- **Date:** 2026-10-29
- **Issue:** [#2](https://github.com/thomasfosterau/effect-l10n/issues/2), [#14](https://github.com/thomasfosterau/effect-l10n/issues/14)

## Context

Messages need plurals, selection, formatting functions and markup. ICU MessageFormat 1 is widespread but loosely specified, and every implementation differs at the edges. Each platform target has its own native syntax (`.xcstrings`, Android `<plurals>`, gettext), so the source syntax must be expressive enough to lower to all of them.

## Decision

Messages are written in **Unicode MessageFormat 2 (MF2)**, the Unicode CLDR specification. `@effect-l10n/messageformat` parses MF2 into a typed data model (an Effect `Schema`), validates it, infers parameter types from the pattern where it can, and formats it as the reference implementation. The compiler lowers that model to each target's native format; ICU MF1 is supported only as an import path for migration (M7).

## Consequences

- The parser and validator are tested against the unicode-org/message-format-wg conformance suites, pinned to a spec version ([#18](https://github.com/thomasfosterau/effect-l10n/issues/18)).
- A target that cannot express a construct (for example, a multi-selector `.match` on a platform with one-dimensional plurals) gets a lowering pass or a structured diagnostic, never silent loss.
- Parameter types inferred from the pattern (`{$count :integer}` is a number) meet the `Schema`s declared on `Message.make` (ADR 0001), and a mismatch is a type error.
- Default functions follow the MF2 registry (`:string`, `:number`, `:integer`, and the draft `:datetime` / `:date` / `:time` / `:currency` / `:percent`), plus a custom-function registry.
