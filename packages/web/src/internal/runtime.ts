// The emitted `runtime.js`: the project's locales and the current locale,
// resolved through the configured strategies in order. Only the configured
// strategies, and the URL helpers only with the `url` strategy, are emitted.
import * as Arr from "effect/Array";
import * as Match from "effect/Match";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

/**
 * Where the runtime looks for the locale, in order.
 *
 * @category options
 * @since 0.1.0
 */
export const Strategy = Schema.Union([
  Schema.Literals([
    "url",
    "cookie",
    "header",
    "preferredLanguage",
    "localStorage",
    "globalVariable",
    "baseLocale",
  ]),
  Schema.TemplateLiteral(["custom-", Schema.String]),
]);

/**
 * @category options
 * @since 0.1.0
 */
export type Strategy = typeof Strategy.Type;

/** The options the runtime is generated from. */
export interface RuntimeOptions {
  readonly strategy: ReadonlyArray<Strategy>;
  readonly cookie: { readonly name: string; readonly maxAge: number; readonly domain?: string };
  readonly localStorageKey: string;
  readonly url: {
    readonly mode: "prefix" | "domain";
    readonly prefixBaseLocale: boolean;
    readonly domains?: R.ReadonlyRecord<string, string>;
    readonly pathnames: R.ReadonlyRecord<string, R.ReadonlyRecord<string, string>>;
  };
}

/** What the generated code embeds as JSON. */
type Embedded =
  | string
  | number
  | boolean
  | ReadonlyArray<Embedded>
  | { readonly [key: string]: Embedded };

const Json = Schema.fromJsonString(Schema.Unknown);
const json = (value: Embedded): string => Schema.encodeSync(Json)(value);

const has = (options: RuntimeOptions, strategy: Strategy) =>
  Arr.contains(options.strategy, strategy);

const customNames = (options: RuntimeOptions): ReadonlyArray<string> =>
  Arr.filterMap(options.strategy, (s) =>
    Str.startsWith("custom-")(s) ? Result.succeed(s.slice("custom-".length)) : Result.failVoid,
  );

const hasCustom = (options: RuntimeOptions) => Arr.isReadonlyArrayNonEmpty(customNames(options));

const negotiation = `const truncate = (tag) => {
  const subtags = tag.split("-");
  subtags.pop();
  while (subtags.length > 0 && subtags[subtags.length - 1].length === 1) subtags.pop();
  return subtags.length > 0 ? subtags.join("-") : undefined;
};

/** RFC 4647 lookup: the first locale a requested tag, or a truncation of it, names. */
export const negotiate = (requested) => {
  for (const range of requested) {
    for (let tag = range; tag !== undefined; tag = truncate(tag)) {
      const found = locales.find((l) => l.toLowerCase() === tag.toLowerCase());
      if (found !== undefined) return found;
    }
  }
  return undefined;
};`;

const cookieReader = (name: string) => `const cookieFrom = (header) => {
  if (!header) return undefined;
  for (const pair of header.split(";")) {
    const at = pair.indexOf("=");
    if (at > 0 && pair.slice(0, at).trim() === ${json(name)}) return decodeURIComponent(pair.slice(at + 1).trim());
  }
  return undefined;
};`;

const acceptLanguage = `const acceptLanguage = (header) =>
  (header || "")
    .split(",")
    .map((item, i) => {
      const [tag, ...params] = item.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { tag: tag.trim(), q: q === undefined ? 1 : Number(q.slice(2)), i };
    })
    .filter((item) => item.tag !== "" && item.tag !== "*" && item.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .map((item) => item.tag);`;

const urlHelpers = (options: RuntimeOptions): string => {
  const { url } = options;
  const shared = `const pathnames = ${json(url.pathnames)};
const localizePath = (path, locale) =>
  Object.prototype.hasOwnProperty.call(pathnames, path) && pathnames[path][locale] !== undefined ? pathnames[path][locale] : path;
const canonicalPath = (path, locale) => {
  for (const canonical of Object.keys(pathnames)) if (pathnames[canonical][locale] === path) return canonical;
  return path;
};
const base = () => (typeof location === "undefined" ? "http://localhost/" : location.href);
const isAbsolute = (href) => /^[a-z][a-z\\d+.-]*:/i.test(href);
const relative = (url, from) =>
  url.origin === new URL(from).origin ? url.pathname + url.search + url.hash : url.href;`;
  const mode =
    url.mode === "prefix"
      ? `const prefixBaseLocale = ${json(url.prefixBaseLocale)};
const split = (pathname) => {
  const segment = pathname.split("/")[1];
  const locale = segment === undefined ? undefined : locales.find((l) => l.toLowerCase() === segment.toLowerCase());
  return locale === undefined ? [undefined, pathname] : [locale, pathname.slice(segment.length + 1) || "/"];
};

/** The locale a URL names, if any. */
export const extractLocaleFromUrl = (url) => {
  const [locale] = split(new URL(url, base()).pathname);
  return locale !== undefined ? locale : prefixBaseLocale ? undefined : baseLocale;
};

/** A URL without its locale: the base locale's unprefixed, canonical path. */
export const deLocalizeUrl = (url) => {
  const next = new URL(url, base());
  const [locale, rest] = split(next.pathname);
  next.pathname = canonicalPath(rest, locale === undefined ? baseLocale : locale);
  return next;
};

/** A URL in a locale, the current one by default. */
export const localizeUrl = (url, options) => {
  const locale = options !== undefined && options.locale !== undefined ? options.locale : getLocale();
  const next = deLocalizeUrl(url);
  const path = localizePath(next.pathname, locale);
  next.pathname = locale === baseLocale && !prefixBaseLocale ? path : "/" + locale + (path === "/" ? "/" : path);
  return next;
};`
      : `const domains = ${json(url.domains ?? {})};
const localeOfHost = (host) => locales.find((l) => domains[l] === host);

/** The locale a URL's host names, if any. */
export const extractLocaleFromUrl = (url) => localeOfHost(new URL(url, base()).host);

/** A URL on the base locale's domain, with its canonical path. */
export const deLocalizeUrl = (url) => {
  const next = new URL(url, base());
  const locale = localeOfHost(next.host);
  next.pathname = canonicalPath(next.pathname, locale === undefined ? baseLocale : locale);
  if (domains[baseLocale] !== undefined) next.host = domains[baseLocale];
  return next;
};

/** A URL on a locale's domain, the current locale's by default. */
export const localizeUrl = (url, options) => {
  const locale = options !== undefined && options.locale !== undefined ? options.locale : getLocale();
  const next = deLocalizeUrl(url);
  next.pathname = localizePath(next.pathname, locale);
  if (domains[locale] !== undefined) next.host = domains[locale];
  return next;
};`;
  return `${shared}

${mode}

/** An href in a locale: relative stays relative when it stays on this origin. */
export const localizeHref = (href, options) => {
  const url = localizeUrl(href, options);
  return isAbsolute(href) ? url.href : relative(url, base());
};

/** An href without its locale. */
export const deLocalizeHref = (href) => {
  const url = deLocalizeUrl(href);
  return isAbsolute(href) ? url.href : relative(url, base());
};

/** The URL in every locale, and \`x-default\`, for \`<link rel="alternate" hreflang>\`. */
export const alternates = (url) =>
  locales
    .map((locale) => ({ hreflang: locale, href: localizeUrl(url, { locale }).href }))
    .concat([{ hreflang: "x-default", href: localizeUrl(url, { locale: baseLocale }).href }]);`;
};

/**
 * A strategy's code: how the client reads it, how a server reads a request
 * for it, and how `setLocale` persists to it; `undefined` or empty where it
 * can't.
 */
interface StrategyCode {
  readonly read: string;
  readonly request: string;
  readonly write: string;
}

const strategyCode = (options: RuntimeOptions, strategy: Strategy): StrategyCode => {
  const { cookie } = options;
  const none = { read: "undefined", request: "undefined", write: "" };
  return Match.value(strategy).pipe(
    Match.when("cookie", () => ({
      read: `typeof document === "undefined" ? undefined : cookieFrom(document.cookie)`,
      request: `cookieFrom(request.headers.get("cookie"))`,
      write: `if (typeof document !== "undefined")
      document.cookie = ${json(`${cookie.name}=`)} + encodeURIComponent(locale) + ${json(
        `; path=/; max-age=${cookie.maxAge}; samesite=lax${cookie.domain === undefined ? "" : `; domain=${cookie.domain}`}`,
      )};`,
    })),
    Match.when("localStorage", () => ({
      ...none,
      read: `storage(() => localStorage.getItem(${json(options.localStorageKey)}))`,
      write: `storage(() => localStorage.setItem(${json(options.localStorageKey)}, locale));`,
    })),
    Match.when("preferredLanguage", () => ({
      ...none,
      read: `typeof navigator === "undefined" ? undefined : negotiate(navigator.languages || [navigator.language])`,
    })),
    Match.when("url", () => ({
      read: `typeof location === "undefined" ? undefined : extractLocaleFromUrl(location.href)`,
      request: "extractLocaleFromUrl(request.url)",
      write: `if (typeof location !== "undefined") {
      const next = localizeUrl(location.href, { locale }).href;
      if (next !== location.href) {
        if (reload) location.href = next;
        else history.pushState(null, "", next);
        navigated = true;
      }
    }`,
    })),
    Match.when("globalVariable", () => ({ ...none, read: "current", write: "current = locale;" })),
    Match.when("baseLocale", () => ({ ...none, read: "baseLocale", request: "baseLocale" })),
    Match.when("header", () => ({
      ...none,
      request: `negotiate(acceptLanguage(request.headers.get("accept-language")))`,
    })),
    Match.orElse((custom) => {
      const name = json(custom.slice("custom-".length));
      return {
        read: `custom(clientStrategies, ${name}, (s) => s.getLocale())`,
        request: `custom(serverStrategies, ${name}, (s) => s.getLocale(request))`,
        write: `custom(clientStrategies, ${name}, (s) => s.setLocale && s.setLocale(locale));`,
      };
    }),
  );
};

/** Generated `runtime.js`. */
export const runtimeModule = (
  locales: ReadonlyArray<string>,
  baseLocale: string,
  options: RuntimeOptions,
): string => {
  const strategies = Arr.dedupe(options.strategy);
  const usesCookie = has(options, "cookie");
  const usesUrl = has(options, "url");
  const codes = Arr.map(strategies, (s) => [s, strategyCode(options, s)] as const);
  const reads = Arr.map(
    codes,
    ([s, code]) => `      case ${json(s)}: found = ${code.read}; break;`,
  );
  const serverReads = Arr.filterMap(codes, ([s, code]) =>
    code.request === "undefined"
      ? Result.failVoid
      : Result.succeed(`      case ${json(s)}: found = ${code.request}; break;`),
  );
  const writes = Arr.filterMap(codes, ([, code]) =>
    code.write === "" ? Result.failVoid : Result.succeed(`    ${code.write}`),
  );
  const sections = [
    `// Generated by effect-l10n. Do not edit.
/** The project's locales. */
export const locales = ${json(locales)};

/** The locale messages fall back to. */
export const baseLocale = ${json(baseLocale)};

/** Where the locale is looked for, in order. */
export const strategy = ${json(strategies)};

/** Whether a value is one of the project's locales. */
export const isLocale = (value) => typeof value === "string" && locales.includes(value);`,
    negotiation,
    ...(usesCookie ? [cookieReader(options.cookie.name)] : []),
    ...(has(options, "header") ? [acceptLanguage] : []),
    ...(has(options, "localStorage")
      ? [
          `const storage = (f) => {
  try {
    return typeof localStorage === "undefined" ? undefined : f();
  } catch {
    return undefined;
  }
};`,
        ]
      : []),
    ...(hasCustom(options)
      ? [
          `const clientStrategies = /* @__PURE__ */ new Map();
const serverStrategies = /* @__PURE__ */ new Map();
const custom = (registry, name, f) => (registry.has(name) ? f(registry.get(name)) : undefined);

/** Defines a \`custom-<name>\` strategy for the client: \`getLocale()\`, and \`setLocale(locale)\` if it persists. */
export const defineCustomClientStrategy = (name, handler) => {
  clientStrategies.set(name, handler);
};

/** Defines a \`custom-<name>\` strategy for the server: \`getLocale(request)\`. */
export const defineCustomServerStrategy = (name, handler) => {
  serverStrategies.set(name, handler);
};`,
        ]
      : []),
    ...(usesUrl ? [urlHelpers(options)] : []),
    `let current;
let getter;
let setter;
const listeners = /* @__PURE__ */ new Set();

/** Replaces how the current locale is found, as the SSR middleware does. */
export const overwriteGetLocale = (fn) => {
  getter = fn;
};

/** Replaces how the locale is set, for a framework that keeps it in its own state. */
export const overwriteSetLocale = (fn) => {
  setter = fn;
};

/** Calls \`listener\` with each new locale; returns a function that stops it. */
export const onLocaleChange = (listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The current locale: the first strategy that names one of the project's locales. */
export const getLocale = () => {
  if (getter !== undefined) return getter();
  for (const name of strategy) {
    let found;
    switch (name) {
${Arr.join(reads, "\n")}
    }
    if (isLocale(found)) return found;
  }
  return baseLocale;
};

/** Sets the locale in every strategy that keeps one, then reloads unless \`reload\` is false. */
export const setLocale = (locale, options) => {
  if (!isLocale(locale)) return;
  const reload = options === undefined || options.reload !== false;
  const previous = getLocale();
  if (setter !== undefined) setter(locale);
  else {
    let navigated = false;
${Arr.join(writes, "\n")}
    if (reload && !navigated && locale !== previous && typeof location !== "undefined") location.reload();
  }
  if (locale !== previous) for (const listener of listeners) listener(locale);
};

/** A request's locale, from the strategies a server can read. */
export const extractLocaleFromRequest = (request) => {
  for (const name of strategy) {
    let found;
    switch (name) {
${Arr.join(serverReads, "\n")}
    }
    if (isLocale(found)) return found;
  }
  return baseLocale;
};`,
  ];
  return `${Arr.join(sections, "\n\n")}\n`;
};

/** Generated `runtime.d.ts`. */
export const runtimeDeclarations = (
  locales: ReadonlyArray<string>,
  baseLocale: string,
  options: RuntimeOptions,
): string => {
  const union = Arr.isReadonlyArrayEmpty(locales)
    ? "never"
    : Arr.join(Arr.map(locales, json), " | ");
  const sections = [
    `// Generated by effect-l10n. Do not edit.
/** One of the project's locales. */
export type Locale = ${union};

/** A strategy the runtime reads the locale from. */
export type Strategy = ${Arr.join(Arr.map(Arr.dedupe(options.strategy), json), " | ") || "never"};

/** The project's locales. */
export declare const locales: readonly [${Arr.join(Arr.map(locales, json), ", ")}];

/** The locale messages fall back to. */
export declare const baseLocale: ${json(baseLocale)};

/** Where the locale is looked for, in order. */
export declare const strategy: ReadonlyArray<Strategy>;

/** Whether a value is one of the project's locales. */
export declare const isLocale: (value: unknown) => value is Locale;

/** RFC 4647 lookup: the first locale a requested tag, or a truncation of it, names. */
export declare const negotiate: (requested: ReadonlyArray<string>) => Locale | undefined;

/** The current locale. */
export declare const getLocale: () => Locale;

/** Sets the locale in every strategy that keeps one, then reloads unless \`reload\` is false. */
export declare const setLocale: (locale: Locale, options?: { readonly reload?: boolean }) => void;

/** Replaces how the current locale is found. */
export declare const overwriteGetLocale: (fn: () => Locale) => void;

/** Replaces how the locale is set. */
export declare const overwriteSetLocale: (fn: (locale: Locale) => void) => void;

/** Calls \`listener\` with each new locale; returns a function that stops it. */
export declare const onLocaleChange: (listener: (locale: Locale) => void) => () => void;

/** A request's locale, from the strategies a server can read. */
export declare const extractLocaleFromRequest: (request: Request) => Locale;

/** How a message is formatted. */
export interface MessageOptions {
  /** The locale; the current one by default. */
  readonly locale?: Locale;
  /** \`default\` isolates placeholders with Unicode bidi controls. */
  readonly bidiIsolation?: "default" | "none";
}

/** A formatted part of a message, as \`.parts()\` returns it. \`M\` is its markup's names. */
export type Part<M extends string = string> =
  | { readonly type: "text"; readonly value: string }
  | {
      readonly type: "markup";
      readonly kind: "open" | "close" | "standalone";
      readonly name: M;
      readonly options: Readonly<Record<string, unknown>>;
      readonly id?: string;
    }
  | { readonly type: "fallback"; readonly source: string }
  | { readonly type: "bidiIsolation"; readonly value: "\\u2066" | "\\u2067" | "\\u2068" | "\\u2069" }
  | {
      readonly type: "string" | "number" | "datetime";
      readonly value: string;
      readonly parts: ReadonlyArray<{ readonly type: string; readonly value: string }>;
      readonly locale: string;
      readonly dir?: "ltr" | "rtl";
      readonly id?: string;
    };

/** A compiled message: call it for a string, or \`.parts()\` for rich text. */
export interface Message<P, M extends string = never> {
  (params: P, options?: MessageOptions): string;
  parts(params: P, options?: MessageOptions): Array<Part<M>>;
}`,
    ...(hasCustom(options)
      ? [
          `/** Defines a \`custom-<name>\` strategy for the client. */
export declare const defineCustomClientStrategy: (
  name: string,
  handler: { readonly getLocale: () => string | undefined; readonly setLocale?: (locale: Locale) => void },
) => void;

/** Defines a \`custom-<name>\` strategy for the server. */
export declare const defineCustomServerStrategy: (
  name: string,
  handler: { readonly getLocale: (request: Request) => string | undefined },
) => void;`,
        ]
      : []),
    ...(has(options, "url")
      ? [
          `/** The locale a URL names, if any. */
export declare const extractLocaleFromUrl: (url: string | URL) => Locale | undefined;

/** A URL in a locale, the current one by default. */
export declare const localizeUrl: (url: string | URL, options?: { readonly locale?: Locale }) => URL;

/** A URL without its locale. */
export declare const deLocalizeUrl: (url: string | URL) => URL;

/** An href in a locale; a relative one stays relative on the same origin. */
export declare const localizeHref: (href: string, options?: { readonly locale?: Locale }) => string;

/** An href without its locale. */
export declare const deLocalizeHref: (href: string) => string;

/** The URL in every locale, and \`x-default\`, for \`<link rel="alternate" hreflang>\`. */
export declare const alternates: (url: string | URL) => ReadonlyArray<{ readonly hreflang: Locale | "x-default"; readonly href: string }>;`,
        ]
      : []),
  ];
  return `${Arr.join(sections, "\n\n")}\n`;
};

/** Generated `server.js`: SSR middleware on the standard `Request` and `Response`. */
export const serverModule = (
  options: RuntimeOptions,
): string => `// Generated by effect-l10n. Do not edit.
import { AsyncLocalStorage } from "node:async_hooks";
import { baseLocale, extractLocaleFromRequest, overwriteGetLocale${
  has(options, "url") ? ", localizeUrl" : ""
} } from "./runtime.js";

let storage;

const install = () => {
  if (storage === undefined) {
    storage = new AsyncLocalStorage();
    overwriteGetLocale(() => {
      const locale = storage.getStore();
      return locale === undefined ? baseLocale : locale;
    });
  }
  return storage;
};

/**
 * Resolves the request's locale and runs \`resolve\` with it as the current
 * locale, isolated from concurrent requests.${
   has(options, "url")
     ? " A GET whose URL isn't in that locale is\n * redirected to the URL that is, unless `redirect` is false."
     : ""
 }
 */
export const middleware = async (request, resolve, options) => {
  const als = install();
  const locale = extractLocaleFromRequest(request);${
    has(options, "url")
      ? `
  if (request.method === "GET" && (options === undefined || options.redirect !== false)) {
    const localized = localizeUrl(request.url, { locale });
    if (localized.href !== new URL(request.url).href) return Response.redirect(localized.href, 307);
  }`
      : ""
  }
  return als.run(locale, () => resolve({ request, locale }));
};

/** Runs \`f\` with \`locale\` as the current locale, as the middleware does for a request. */
export const withLocale = (locale, f) => install().run(locale, f);
`;

/** Generated `server.d.ts`. */
export const serverDeclarations = `// Generated by effect-l10n. Do not edit.
import type { Locale } from "./runtime.js";

/** Resolves the request's locale and runs \`resolve\` with it as the current locale. */
export declare const middleware: (
  request: Request,
  resolve: (args: { readonly request: Request; readonly locale: Locale }) => Response | Promise<Response>,
  options?: { readonly redirect?: boolean },
) => Promise<Response>;

/** Runs \`f\` with \`locale\` as the current locale. */
export declare const withLocale: <A>(locale: Locale, f: () => A) => A;
`;
