import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import { assert, describe, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as R from "effect/Record";
import { afterEach, vi } from "vite-plus/test";
import { emit, importFrom, writeTree } from "./__fixtures__/harness";
import type { Options } from "./WebTarget";

interface Runtime {
  readonly locales: ReadonlyArray<string>;
  readonly getLocale: () => string;
  readonly setLocale: (locale: string, options?: { readonly reload?: boolean }) => void;
  readonly negotiate: (requested: ReadonlyArray<string>) => string | undefined;
  readonly overwriteGetLocale: (fn: () => string) => void;
  readonly overwriteSetLocale: (fn: (locale: string) => void) => void;
  readonly onLocaleChange: (listener: (locale: string) => void) => () => void;
  readonly extractLocaleFromRequest: (request: Request) => string;
  readonly extractLocaleFromUrl: (url: string) => string | undefined;
  readonly localizeHref: (href: string, options?: { readonly locale?: string }) => string;
  readonly deLocalizeHref: (href: string) => string;
  readonly localizeUrl: (url: string, options?: { readonly locale?: string }) => URL;
  readonly alternates: (url: string) => ReadonlyArray<{ hreflang: string; href: string }>;
  readonly defineCustomClientStrategy: (
    name: string,
    handler: { getLocale: () => string | undefined; setLocale?: (l: string) => void },
  ) => void;
  readonly defineCustomServerStrategy: (
    name: string,
    handler: { getLocale: (request: Request) => string | undefined },
  ) => void;
}

const sources = [{ id: "hello", locales: { en: "Hello", de: "Hallo", ar: "Hello" } }];

/** A fresh runtime, so no state carries over from another test. */
const runtime = Effect.fn("runtime")(function* (options: typeof Options.Encoded) {
  const path = yield* Path.Path;
  const dir = yield* writeTree(yield* emit(sources, options));
  return yield* importFrom<Runtime>(path.join(dir, "runtime.js"));
});

/** Browser globals: a cookie jar, `localStorage`, `navigator` and `location`. */
const browser = (state: {
  readonly cookie?: string;
  readonly storage?: string;
  readonly languages?: ReadonlyArray<string>;
  readonly href?: string;
}) => {
  const jar = new Map<string, string>();
  if (state.cookie !== undefined) jar.set("l10n-locale", state.cookie);
  const storage = new Map<string, string>();
  if (state.storage !== undefined) storage.set("l10n-locale", state.storage);
  const location = { href: state.href ?? "https://example.com/", reload: vi.fn<() => void>() };
  const history = { pushState: vi.fn<(state: null, unused: string, url: string) => void>() };
  vi.stubGlobal("document", {
    get cookie() {
      return Arr.join(
        Arr.map(Array.from(jar), ([k, v]) => `${k}=${v}`),
        "; ",
      );
    },
    set cookie(value: string) {
      const [pair = ""] = value.split(";");
      const at = pair.indexOf("=");
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    },
  });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal("navigator", { languages: state.languages ?? [], language: "" });
  vi.stubGlobal("location", location);
  vi.stubGlobal("history", history);
  return { jar, storage, location, history };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const all = {
  strategy: ["url", "cookie", "localStorage", "preferredLanguage", "baseLocale"],
} as const;

describe("runtime", () => {
  it.layer(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))((scoped) => {
    scoped.effect("resolves the first strategy that names a locale, in order", () =>
      Effect.gen(function* () {
        const rt = yield* runtime(all);
        const cases: ReadonlyArray<readonly [Parameters<typeof browser>[0], string]> = [
          [
            { href: "https://example.com/de/x", cookie: "ar", storage: "ar", languages: ["ar"] },
            "de",
          ],
          // The base locale has no prefix, so an unprefixed URL names it.
          [{ href: "https://example.com/x", cookie: "ar" }, "en"],
        ];
        Arr.forEach(cases, ([state, expected]) => {
          browser(state);
          assert.strictEqual(rt.getLocale(), expected);
          vi.unstubAllGlobals();
        });
        const later = yield* runtime({
          strategy: ["cookie", "localStorage", "preferredLanguage", "baseLocale"],
        });
        const matrix: ReadonlyArray<readonly [Parameters<typeof browser>[0], string]> = [
          [{ cookie: "ar", storage: "de", languages: ["de"] }, "ar"],
          [{ cookie: "fr", storage: "de", languages: ["ar"] }, "de"],
          [{ storage: "xx", languages: ["fr-CA", "de-AT"] }, "de"],
          [{ languages: ["fr"] }, "en"],
          [{}, "en"],
        ];
        Arr.forEach(matrix, ([state, expected], i) => {
          browser(state);
          assert.strictEqual(later.getLocale(), expected, `case ${i}`);
          vi.unstubAllGlobals();
        });
      }),
    );

    scoped.effect("falls back to the base locale on a server, with no browser globals", () =>
      Effect.gen(function* () {
        const rt = yield* runtime(all);
        assert.strictEqual(rt.getLocale(), "en");
        rt.setLocale("de");
        assert.strictEqual(rt.negotiate(["de-CH-1996", "en"]), "de");
        assert.isUndefined(rt.negotiate(["fr"]));
      }),
    );

    scoped.effect("sets the locale in each strategy, notifies and reloads", () =>
      Effect.gen(function* () {
        const rt = yield* runtime({ strategy: ["cookie", "localStorage", "globalVariable"] });
        const { jar, storage, location } = browser({});
        const seen: Array<string> = [];
        const stop = rt.onLocaleChange((l) => seen.push(l));
        rt.setLocale("de");
        assert.strictEqual(jar.get("l10n-locale"), "de");
        assert.strictEqual(storage.get("l10n-locale"), "de");
        assert.strictEqual(rt.getLocale(), "de");
        assert.strictEqual(location.reload.mock.calls.length, 1);
        rt.setLocale("ar", { reload: false });
        assert.strictEqual(location.reload.mock.calls.length, 1);
        rt.setLocale("xx");
        stop();
        rt.setLocale("en", { reload: false });
        assert.deepStrictEqual(seen, ["de", "ar"]);
      }),
    );

    scoped.effect("navigates to the localised URL with the url strategy", () =>
      Effect.gen(function* () {
        const rt = yield* runtime({ strategy: ["url", "baseLocale"] });
        const { location, history } = browser({ href: "https://example.com/about?q=1" });
        rt.setLocale("de", { reload: false });
        assert.deepStrictEqual(
          history.pushState.mock.calls[0]?.[2],
          "https://example.com/de/about?q=1",
        );
        rt.setLocale("ar");
        assert.strictEqual(location.href, "https://example.com/ar/about?q=1");
        assert.strictEqual(location.reload.mock.calls.length, 0);
      }),
    );

    scoped.effect("lets an application replace getting and setting the locale", () =>
      Effect.gen(function* () {
        const rt = yield* runtime({});
        const set: Array<string> = [];
        rt.overwriteGetLocale(() => "ar");
        rt.overwriteSetLocale((l) => set.push(l));
        assert.strictEqual(rt.getLocale(), "ar");
        rt.setLocale("de");
        assert.deepStrictEqual(set, ["de"]);
      }),
    );

    scoped.effect("reads custom strategies on the client and the server", () =>
      Effect.gen(function* () {
        const rt = yield* runtime({ strategy: ["custom-session", "baseLocale"] });
        const stored: Array<string> = [];
        let session: string | undefined;
        rt.defineCustomClientStrategy("session", {
          getLocale: () => session,
          setLocale: (l) => stored.push(l),
        });
        rt.defineCustomServerStrategy("session", {
          getLocale: (request) => request.headers.get("x-locale") ?? undefined,
        });
        assert.strictEqual(rt.getLocale(), "en");
        session = "ar";
        assert.strictEqual(rt.getLocale(), "ar");
        rt.setLocale("de", { reload: false });
        assert.deepStrictEqual(stored, ["de"]);
        const request = new Request("https://example.com/", { headers: { "x-locale": "de" } });
        assert.strictEqual(rt.extractLocaleFromRequest(request), "de");
      }),
    );

    scoped.effect("reads a request's URL, cookie and Accept-Language in order", () =>
      Effect.gen(function* () {
        const rt = yield* runtime({
          strategy: ["url", "cookie", "header", "baseLocale"],
          url: { prefixBaseLocale: true },
        });
        const request = (url: string, headers: R.ReadonlyRecord<string, string>) =>
          rt.extractLocaleFromRequest(new Request(url, { headers }));
        assert.strictEqual(request("https://example.com/ar/x", { cookie: "l10n-locale=de" }), "ar");
        assert.strictEqual(
          request("https://example.com/x", { cookie: "a=1; l10n-locale=de" }),
          "de",
        );
        assert.strictEqual(
          request("https://example.com/x", { "accept-language": "fr;q=1, de-AT;q=0.9, ar;q=0.8" }),
          "de",
        );
        assert.strictEqual(
          request("https://example.com/x", { "accept-language": "ar;q=0.5, de;q=0" }),
          "ar",
        );
        assert.strictEqual(request("https://example.com/x", {}), "en");
      }),
    );

    scoped.effect("localises and de-localises URLs by path prefix", () =>
      Effect.gen(function* () {
        const rt = yield* runtime({
          strategy: ["url", "baseLocale"],
          url: { pathnames: { "/about": { de: "/ueber-uns" } } },
        });
        assert.strictEqual(
          rt.localizeHref("/about?q=1#top", { locale: "de" }),
          "/de/ueber-uns?q=1#top",
        );
        assert.strictEqual(rt.localizeHref("/", { locale: "ar" }), "/ar/");
        assert.strictEqual(rt.localizeHref("/de/ueber-uns", { locale: "en" }), "/about");
        assert.strictEqual(rt.deLocalizeHref("/ar/about"), "/about");
        assert.strictEqual(
          rt.localizeUrl("https://example.com/DE/ueber-uns", { locale: "ar" }).href,
          "https://example.com/ar/about",
        );
        assert.strictEqual(rt.extractLocaleFromUrl("https://example.com/de"), "de");
        assert.strictEqual(rt.extractLocaleFromUrl("https://example.com/deutsch"), "en");
        assert.deepStrictEqual(rt.alternates("https://example.com/de/ueber-uns"), [
          { hreflang: "en", href: "https://example.com/about" },
          { hreflang: "de", href: "https://example.com/de/ueber-uns" },
          { hreflang: "ar", href: "https://example.com/ar/about" },
          { hreflang: "x-default", href: "https://example.com/about" },
        ]);
        const prefixed = yield* runtime({ strategy: ["url"], url: { prefixBaseLocale: true } });
        assert.strictEqual(prefixed.localizeHref("/x", { locale: "en" }), "/en/x");
        assert.isUndefined(prefixed.extractLocaleFromUrl("https://example.com/x"));
      }),
    );

    scoped.effect("localises URLs by domain", () =>
      Effect.gen(function* () {
        const rt = yield* runtime({
          strategy: ["url", "baseLocale"],
          url: { mode: "domain", domains: { en: "example.com", de: "example.de" } },
        });
        browser({ href: "https://example.com/start" });
        assert.strictEqual(rt.localizeHref("/x", { locale: "de" }), "https://example.de/x");
        assert.strictEqual(rt.localizeHref("/x", { locale: "en" }), "/x");
        assert.strictEqual(rt.deLocalizeHref("https://example.de/x"), "https://example.com/x");
        assert.strictEqual(rt.extractLocaleFromUrl("https://example.de/"), "de");
        assert.strictEqual(rt.getLocale(), "en");
      }),
    );
  });
});
