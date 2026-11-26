# Server-side rendering with the web target

A fetch handler that renders a page in each request's locale: from the URL (`/de/…`), then the `l10n-locale` cookie, then `Accept-Language`. A request whose URL isn't in its locale is redirected to the one that is, `alternates` writes the `hreflang` links, and `.parts()` renders the rich text.

From the repository root, after `vp install` and `vp run -r build`:

```sh
cd examples/ssr
vp exec node build.ts          # writes generated/l10n/web
deno serve server.ts           # or: bun server.ts
```

Requests run concurrently without sharing a locale: the middleware keeps each one's in `AsyncLocalStorage`. See [the web target guide](../../docs/web.md).
