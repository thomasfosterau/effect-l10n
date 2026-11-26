// A fetch handler that renders a page in the request's locale: Deno, Bun and
// workers serve it as it is; on Node, any adapter from `fetch` handlers.
import { middleware } from "./generated/l10n/web/server.js";
import { alternates, getLocale, localizeHref, locales } from "./generated/l10n/web/runtime.js";
import type { Part } from "./generated/l10n/web/runtime.js";
import * as m from "./generated/l10n/web/messages.js";

const escape = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

/** Rich text as HTML: `{#b}` becomes `<strong>`. */
const html = (parts: ReadonlyArray<Part<"b">>) =>
  parts
    .map((part) => {
      if (part.type === "markup") return part.kind === "close" ? "</strong>" : "<strong>";
      if (part.type === "fallback") return escape(`{${part.source}}`);
      return escape(part.value);
    })
    .join("");

const page = (request: Request) => {
  const links = alternates(request.url)
    .map((a) => `<link rel="alternate" hreflang="${a.hreflang}" href="${escape(a.href)}">`)
    .join("\n    ");
  const switcher = locales
    .map((locale) => `<a href="${escape(localizeHref("/", { locale }))}">${locale}</a>`)
    .join(" · ");
  return `<!doctype html>
<html lang="${getLocale()}">
  <head>
    <meta charset="utf-8">
    ${links}
  </head>
  <body>
    <h1>${escape(m.title({ name: "Ana" }))}</h1>
    <p>${html(m.visits.parts({ count: 3 }))}</p>
    <p><a href="${escape(localizeHref("/about"))}">${escape(m.about())}</a></p>
    <nav>${switcher}</nav>
  </body>
</html>`;
};

export default {
  fetch: (request: Request) =>
    middleware(
      request,
      () =>
        new Response(page(request), { headers: { "content-type": "text/html; charset=utf-8" } }),
    ),
};
