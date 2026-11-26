# 0009. Web output: a module per message over generated helpers

- **Status:** Accepted
- **Date:** 2026-11-26

## Context

The web target must emit plain JavaScript (ADR 0003) that formats exactly as the reference formatter does, that a bundler can tree-shake to the messages and functions an app uses, and that stays small. Two layouts were possible for a message's locales: every locale inlined into the message's module, or a module per message and locale that the app loads for its locale. Formatting itself could be compiled to string concatenation per message, or to calls into shared helpers that mirror the reference's functions.

## Decision

- **One module per message, its locales inlined.** Each locale's selection plan (ADR 0008) compiles to a function that returns parts; identical locales share one function. The export is a `/* @__PURE__ */` call, so an unused message drops out.
- **Shared helpers in a generated `internal.js`.** The default MessageFormat functions, option decoding, fallbacks and bidi isolation are plain JavaScript that mirrors the reference formatter, each function a separate export so unused ones drop out. `Intl` objects are cached per locale and options.
- **Strings through parts.** A message's string is its parts joined, so `.parts()` and the string can't disagree.
- **A generated `runtime.js`** holds the locale state and only the configured strategies (ADR 0005); `server.js` adds the SSR middleware, so browser bundles never see `AsyncLocalStorage`.
- **Equivalence is tested, not assumed:** the emitted modules are compared with the reference formatter over the MessageFormat 2 conformance suite and across plural-heavy locales, strings and parts.

## Consequences

- An app ships every locale of the messages it imports. For apps with many locales the split layout would ship less; it is left as an option to add once it is measured.
- The helpers duplicate the reference functions' semantics in JavaScript, so a change to a function lands in both, held together by the equivalence tests.
- Custom functions need a JavaScript implementation before the web target can format them; until then they are reported as unsupported.
