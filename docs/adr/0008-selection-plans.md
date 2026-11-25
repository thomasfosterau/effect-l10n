# 0008. Lower selection through plans, not variant flattening

- **Status:** Accepted
- **Date:** 2026-11-25

## Context

MessageFormat 2 selects a variant by sorting every variant on each selector's key preference in turn. Native resources are much weaker: Android `<plurals>` and String Catalog variations hold one plural selector over CLDR categories, mostly without exact-number keys, and nothing else. A target must still produce exactly what the reference formatter would, for every locale.

Flattening a multi-selector message into the cartesian product of its keys grows exponentially and still doesn't say what a resource holds and what code decides. Copying variants into each locale's categories loses MF2's rule that an exact key beats a category.

## Decision

The compiler represents selection as a plan: a `Switch` per selector whose cases are tried in the order the selector's function prefers their keys, then its `*` case; a `Chain` that tries plans in turn, falling through when one matches nothing; and a `Leaf` pattern. `Plan.fromMessage` builds one `Switch` level per selector, which selects exactly as MF2 does.

Lowering rewrites plans for a target's capabilities. A plural switch on a target with plural resources becomes a chain: a switch of its exact keys (in the accessor, unless the target holds exact keys), then a switch with one case per CLDR category of the locale, each falling through to `*`. Selectors the resources can't hold are placed in the accessor; functions the target can't format are preformatted by the accessor into fresh string parameters; markup is stripped or kept. A target without accessors reports `unsupported-feature` for what's left.

Every lowering is tested against the reference formatter, for every CLDR plural category of a set of locales.

## Consequences

- Targets get one shape to read, and decide only how to emit a `Switch` at its placement.
- No cartesian products: a message's plan grows with its variants, not their product.
- The equivalence tests pin lowering to MF2 semantics, so a target is correct if it emits each switch faithfully.
- Targets must emit chains with fall-through, which is more than copying variants.
