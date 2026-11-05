# 0005. Paraglide-style locale strategies for the web runtime

- **Status:** Accepted
- **Date:** 2026-10-29
- **Issue:** [#2](https://github.com/thomasfosterau/effect-l10n/issues/2), [#14](https://github.com/thomasfosterau/effect-l10n/issues/14)

## Context

A web application decides the current locale from several sources (the URL, a cookie, the `Accept-Language` header, `navigator.languages`, `localStorage`), in an order that differs per application and between server and client. Paraglide JS models this as an ordered list of strategies, which has worked well in practice.

## Decision

The generated web runtime resolves the locale through an **ordered, configurable list of strategies**: `url`, `cookie`, `header`, `navigator`, `localStorage` and custom ones, falling back along a **fallback chain** to the base locale. It also ships **localised URL helpers** and **SSR middleware**. Framework adapters (React, Svelte, Vue, Solid, Astro) are thin layers added later (M4, [#43](https://github.com/thomasfosterau/effect-l10n/issues/43)).

## Consequences

- The runtime stays framework-neutral and plain JS (ADR 0003); adapters only bind it to a framework's reactivity.
- Locale negotiation follows BCP 47 lookup and fallback (M2, [#26](https://github.com/thomasfosterau/effect-l10n/issues/26)), shared with the build-time locale model.
- The strategy set is configuration in `effect-l10n.config.ts`, so server and client resolve the same locale from the same request.
