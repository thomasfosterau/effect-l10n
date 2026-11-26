# The web target

> [!WARNING]
> Experimental: the emitted API and the options will change before 1.0.

`@thomasfosterau/effect-l10n-web` compiles a project to plain JavaScript for browsers, Node, Deno, Bun and edge runtimes: one ES module per message, typed by its `.d.ts`, over a small generated runtime that tracks the current locale. The output calls `Intl` directly and imports neither Effect nor a MessageFormat parser ([ADR 0003](adr/0003-effect-at-build-time-only.md), [ADR 0009](adr/0009-web-output.md)).

```ts
// effect-l10n.config.ts
import { defineConfig } from "@thomasfosterau/effect-l10n/Config";
import { web } from "@thomasfosterau/effect-l10n-web/WebTarget";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "de", "ar"],
  catalogs: ["src/**/*.messages.ts"],
  targets: [web({ strategy: ["url", "cookie", "preferredLanguage", "baseLocale"] })],
});
```

## Output

The compiler writes it to `<outDir>/web/` (`generated/l10n/web/` by default):

| File                                     | Contents                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `messages/<id>.js`, `messages/<id>.d.ts` | One message, every locale inlined, exported under its identifier               |
| `messages.js`, `messages.d.ts`           | Re-exports every message, for `import * as m from ".../messages.js"`           |
| `runtime.js`, `runtime.d.ts`             | The locales, the current locale, the configured strategies and the URL helpers |
| `server.js`, `server.d.ts`               | SSR middleware on the standard `Request` and `Response`                        |
| `internal.js`, `internal.d.ts`           | The MessageFormat functions and the helpers the message modules call           |

With `output: "ts"`, the message modules and `messages.ts` are TypeScript instead, typed inline; the runtime stays `.js` with its `.d.ts`.

A message's export name is its ID's segments in `camelCase`, joined by `_` (`checkout_totalPrice` for `checkout.totalPrice`), with `_` appended to a reserved word.

## Calling messages

```ts
import * as m from "./generated/l10n/web/messages.js";

m.greeting({ name: "Ana" }); // in the current locale
m.items({ count: 3 }, { locale: "de" });
```

Parameters are typed from the functions the source reads them through: `number` for `:number`, `:integer`, `:offset` and `:percent`; `Date | number | string` for `:date`, `:time` and `:datetime`; a number or `{ value, currency }` for `:currency`; a primitive otherwise. A message's description and context become its JSDoc.

The second argument takes `locale` and `bidiIsolation`: `default` wraps placeholders in Unicode isolates, as the reference formatter does, and `none` doesn't. Formatting follows the reference formatter exactly, fallbacks included (`{$name}` for a missing parameter); the tests compare the two over the MessageFormat 2 conformance suite and across plural-heavy locales.

Bundlers drop the messages an app doesn't import, and the functions no imported message calls: an app that imports one plain message ships about 1.4 kB gzipped. CI holds the budgets in `packages/web/src/Size.test.ts`.

### Rich text

`.parts()` returns the formatted parts instead of a string, markup included, so a framework can render it. The markup names are typed:

```ts
const parts = m.checkout_total.parts({ amount: 12.5, when: new Date() });
// Array<Part<"b">>

const render = (parts: ReadonlyArray<Part<"b">>): DocumentFragment => {
  const root = document.createDocumentFragment();
  const stack: Array<Node> = [root];
  for (const part of parts) {
    const top = stack[stack.length - 1]!;
    if (part.type === "markup") {
      if (part.kind === "open") stack.push(top.appendChild(document.createElement("strong")));
      else if (part.kind === "close") stack.pop();
    } else if (part.type === "fallback")
      top.appendChild(document.createTextNode(`{${part.source}}`));
    else top.appendChild(document.createTextNode(part.value));
  }
  return root;
};
```

The bidi isolates are parts of their own (`bidiIsolation`), so rendering their `value` as text keeps the isolation; a renderer can use `<bdi>` instead.

## The current locale

The runtime resolves the locale through `strategy`, in order, and falls back to the base locale (the source locale). Only the configured strategies are emitted.

| Strategy            | Client                                      | Server (`extractLocaleFromRequest`) | `setLocale`                      |
| ------------------- | ------------------------------------------- | ----------------------------------- | -------------------------------- |
| `url`               | `location.href`, through the URL helpers    | the request URL                     | navigates to the localised URL   |
| `cookie`            | `document.cookie` (`cookie.name`)           | the `Cookie` header                 | writes the cookie                |
| `header`            | —                                           | `Accept-Language`, by `q`           | —                                |
| `preferredLanguage` | `navigator.languages`                       | —                                   | —                                |
| `localStorage`      | `localStorage` (`localStorageKey`)          | —                                   | writes it                        |
| `globalVariable`    | a variable in the runtime                   | —                                   | sets it                          |
| `baseLocale`        | the base locale                             | the base locale                     | —                                |
| `custom-<name>`     | `defineCustomClientStrategy(name, handler)` | `defineCustomServerStrategy`        | the client handler's `setLocale` |

The default is `["cookie", "globalVariable", "preferredLanguage", "baseLocale"]`. Requested tags such as `de-AT` from `Accept-Language` or `navigator.languages` are matched by RFC 4647 lookup (`negotiate`); a cookie, `localStorage` or custom value must name a project locale exactly.

`runtime.js` exports:

- `locales`, `baseLocale`, `strategy`, `isLocale(value)` and `negotiate(requested)`.
- `getLocale()`, and `setLocale(locale, { reload })`, which writes every strategy that keeps a locale and reloads the page unless `reload` is `false` (with `url`, it navigates instead).
- `onLocaleChange(listener)`, which returns a function that removes the listener.
- `overwriteGetLocale(fn)` and `overwriteSetLocale(fn)`, for a framework that keeps the locale in its own state.
- `extractLocaleFromRequest(request)`.

## URLs

With the `url` strategy, `url` sets how a URL carries the locale:

- `mode: "prefix"` (the default): a path prefix, `/de/about`. The base locale has none unless `prefixBaseLocale` is `true`.
- `mode: "domain"`: a host per locale, from `domains` (`{ en: "example.com", de: "example.de" }`).
- `pathnames`: localised paths by canonical path, `{ "/about": { de: "/ueber-uns" } }`.

The runtime then exports `localizeUrl(url, { locale })` and `deLocalizeUrl(url)`, which return `URL`s; `localizeHref(href, { locale })` and `deLocalizeHref(href)`, which keep a relative href relative while it stays on the same origin; `extractLocaleFromUrl(url)`; and `alternates(url)`, every locale's URL and `x-default`, for `<link rel="alternate" hreflang>`.

## Server-side rendering

`server.js` exports `middleware(request, resolve, { redirect })`, on the standard `Request` and `Response`, so it fits any server that has them (Node frameworks, Deno, Bun, workers). It resolves the request's locale with `extractLocaleFromRequest` and runs `resolve({ request, locale })` with that locale current: `getLocale()` and every message read it, isolated from concurrent requests through `AsyncLocalStorage`. With the `url` strategy, a `GET` whose URL isn't in that locale is redirected (`307`) to the URL that is, unless `redirect` is `false`. `withLocale(locale, f)` does the same for code outside a request.

`examples/ssr` is a complete server.

## Not yet

- Custom functions: the web target implements the default functions, drafts included. Formatting with another function is an `unsupported-feature` error, and selecting on one falls back to `*`, as the reference formatter does for an unknown function.
- Splitting each message's locales into their own modules, and benchmarks against other libraries ([#121](https://github.com/thomasfosterau/effect-l10n/issues/121)); `URLPattern` routes and JavaScript implementations of custom functions ([#122](https://github.com/thomasfosterau/effect-l10n/issues/122)); framework adapters ([#43](https://github.com/thomasfosterau/effect-l10n/issues/43)).
