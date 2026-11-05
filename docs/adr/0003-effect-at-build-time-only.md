# 0003. Effect only at build time; web output is plain JS

- **Status:** Accepted
- **Date:** 2026-10-29
- **Issue:** [#2](https://github.com/thomasfosterau/effect-l10n/issues/2), [#14](https://github.com/thomasfosterau/effect-l10n/issues/14)

## Context

Effect gives the toolkit typed errors, services, layers and `Schema`, which suit a compiler, a CLI and the authoring API. But a localisation runtime ships to every page view: its bundle size and dependency footprint matter more than its internals, and an application should not need Effect to show a translated string.

## Decision

**Effect is a build-time dependency only.** The authoring API, the MF2 engine, the compiler, the targets and the CLI are Effect programs. The **web output is plain, dependency-free JavaScript** (one tree-shakeable ES module per message plus a small generated runtime) that uses `Intl` directly. Apple and Android outputs are native resources and native code.

## Consequences

- Library packages declare `effect` as a peer dependency (one copy per tree; AGENTS.md), never a dependency, and nothing they emit imports it.
- The web target tests the emitted modules for size and tree-shaking (M4, [#42](https://github.com/thomasfosterau/effect-l10n/issues/42)) and with no Effect installed.
- Formatting behaviour exists twice: the reference formatter in `@effect-l10n/messageformat` (Effect, for validation and tests) and the generated runtime (plain JS). Golden-file tests compare the two over the same fixtures.
