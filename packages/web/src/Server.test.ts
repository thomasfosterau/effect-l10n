import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import { assert, describe, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { type Compiled, emit, importFrom, writeTree } from "./__fixtures__/harness";
import type { Options } from "./WebTarget";

interface Server {
  readonly middleware: (
    request: Request,
    resolve: (args: { request: Request; locale: string }) => Response | Promise<Response>,
    options?: { readonly redirect?: boolean },
  ) => Promise<Response>;
  readonly withLocale: <A>(locale: string, f: () => A) => A;
}

class RequestFailed extends Schema.TaggedError<RequestFailed, { readonly brand: unique symbol }>()(
  "RequestFailed",
  { cause: Schema.Unknown },
) {}

const sources = [
  { id: "hello", locales: { en: "Hello {$name}", de: "Hallo {$name}", ar: "مرحبا {$name}" } },
];

const app = Effect.fn("app")(function* (options: typeof Options.Encoded) {
  const path = yield* Path.Path;
  const dir = yield* writeTree(yield* emit(sources, options));
  const server = yield* importFrom<Server>(path.join(dir, "server.js"));
  const { hello } = yield* importFrom<{ hello: Compiled }>(path.join(dir, "messages.js"));
  return { server, hello };
});

const send = <A>(f: () => Promise<A>) =>
  Effect.tryPromise({ try: f, catch: (cause) => new RequestFailed({ cause }) });

const ok = () => new Response("ok");

describe("SSR middleware", () => {
  it.layer(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))((scoped) => {
    scoped.effect("keeps each concurrent request's locale to itself", () =>
      Effect.gen(function* () {
        const { server, hello } = yield* app({ strategy: ["cookie", "header", "baseLocale"] });
        const handle = (cookie: string, delay: number) =>
          send(() =>
            server.middleware(
              new Request("https://example.com/", { headers: { cookie } }),
              async ({ locale }) => {
                const before = hello({ name: "A" }, { bidiIsolation: "none" });
                await new Promise((resolve) => setTimeout(resolve, delay));
                const after = hello({ name: "A" }, { bidiIsolation: "none" });
                return new Response(`${locale} ${before} ${after}`);
              },
            ),
          ).pipe(Effect.flatMap((response) => send(() => response.text())));
        const bodies = yield* Effect.all(
          Arr.map(
            [
              ["l10n-locale=de", 30],
              ["l10n-locale=ar", 10],
              ["", 20],
              ["l10n-locale=de", 5],
            ] as const,
            ([cookie, delay]) => handle(cookie, delay),
          ),
          { concurrency: "unbounded" },
        );
        assert.deepStrictEqual(bodies, [
          "de Hallo A Hallo A",
          "ar مرحبا A مرحبا A",
          "en Hello A Hello A",
          "de Hallo A Hallo A",
        ]);
        // Outside a request, the base locale.
        assert.strictEqual(hello({ name: "A" }, { bidiIsolation: "none" }), "Hello A");
        assert.strictEqual(
          server.withLocale("de", () => hello({ name: "A" }, { bidiIsolation: "none" })),
          "Hallo A",
        );
      }),
    );

    scoped.effect("redirects a GET to the URL of the locale it resolved", () =>
      Effect.gen(function* () {
        const { server } = yield* app({ strategy: ["cookie", "url", "baseLocale"] });
        const get = (url: string, cookie: string, options?: { readonly redirect?: boolean }) =>
          send(() => server.middleware(new Request(url, { headers: { cookie } }), ok, options));
        const redirected = yield* get("https://example.com/about", "l10n-locale=de");
        assert.strictEqual(redirected.status, 307);
        assert.strictEqual(redirected.headers.get("location"), "https://example.com/de/about");
        const staying = yield* get("https://example.com/de/about", "l10n-locale=de");
        assert.strictEqual(staying.status, 200);
        const fromUrl = yield* get("https://example.com/ar/about", "");
        assert.strictEqual(fromUrl.status, 200);
        const unredirected = yield* get("https://example.com/about", "l10n-locale=de", {
          redirect: false,
        });
        assert.strictEqual(unredirected.status, 200);
      }),
    );
  });
});
