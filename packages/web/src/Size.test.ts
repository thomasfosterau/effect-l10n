import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import { assert, describe, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as P from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { build } from "vite-plus";
import { emit, writeTree } from "./__fixtures__/harness";
import type { Options } from "./WebTarget";

class BundleFailed extends Schema.TaggedError<BundleFailed, { readonly brand: unique symbol }>()(
  "BundleFailed",
  { cause: Schema.Unknown },
) {}

/** Gzipped size budgets in bytes, which CI enforces through this test. */
const budgets = {
  /** `runtime.js` with only the `baseLocale` strategy. */
  runtime: 2048,
  /** An app that imports one plain message. */
  oneMessage: 2048,
  /** An app that imports one plural message with every strategy. */
  pluralWithStrategies: 4096,
};

const sources = [
  { id: "hello", locales: { en: "Hello {$name}", de: "Hallo {$name}" } },
  {
    id: "items",
    locales: {
      en: ".input {$count :integer} .match $count one {{One item}} * {{{$count} items}}",
      de: ".input {$count :integer} .match $count one {{Ein Artikel}} * {{{$count} Artikel}}",
    },
  },
  {
    id: "meeting",
    locales: {
      en: "Meeting on {$when :datetime dateFields=year-month-day-weekday}",
      de: "Besprechung am {$when :datetime dateFields=year-month-day-weekday}",
    },
  },
  {
    id: "price",
    locales: {
      en: "Price: {$amount :currency currency=EUR}",
      de: "Preis: {$amount :currency currency=EUR}",
    },
  },
];

/** Bundles and minifies `entry` against the emitted output; the chunk's code. */
const bundle = Effect.fn("bundle")(function* (options: typeof Options.Encoded, entry: string) {
  const path = yield* Path.Path;
  const dir = yield* writeTree({
    ...(yield* emit(sources, options)),
    "entry.js": entry,
  });
  const output = yield* Effect.tryPromise({
    try: () =>
      build({
        root: dir,
        configFile: false,
        logLevel: "silent",
        build: {
          write: false,
          minify: true,
          lib: { entry: path.join(dir, "entry.js"), formats: ["es"], fileName: "app" },
          rolldownOptions: { output: { minify: true } },
        },
      }),
    catch: (cause) => new BundleFailed({ cause }),
  });
  const results = Arr.isArray(output) ? output : [output];
  const code = Arr.flatMap(results, (result) =>
    P.hasProperty(result, "output") && Arr.isArray(result.output)
      ? Arr.filterMap(result.output, (chunk) =>
          P.hasProperty(chunk, "code") && P.isString(chunk.code)
            ? Result.succeed(chunk.code)
            : Result.failVoid,
        )
      : [],
  );
  return Arr.join(code, "\n");
});

/** The gzipped size of `code`, in bytes. */
const gzipped = (code: string) =>
  Effect.tryPromise({
    try: () =>
      new Response(new Blob([code]).stream().pipeThrough(new CompressionStream("gzip")))
        .arrayBuffer()
        .then((bytes) => bytes.byteLength),
    catch: (cause) => new BundleFailed({ cause }),
  });

describe("bundles", () => {
  it.layer(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))((scoped) => {
    scoped.effect("tree-shake unused messages and functions away", () =>
      Effect.gen(function* () {
        const code = yield* bundle(
          { strategy: ["baseLocale"] },
          `import { hello } from "./messages.js";\nexport const run = () => hello({ name: "x" });\n`,
        );
        assert.include(code, "Hallo ");
        Arr.forEach(
          ["Artikel", "Besprechung", "Preis", "dateFields", "currencyDisplay", "DateTimeFormat"],
          (unused) => assert.notInclude(code, unused),
        );
        assert.isAtMost(yield* gzipped(code), budgets.oneMessage);
      }),
    );

    scoped.effect("keep the runtime within its budget", () =>
      Effect.gen(function* () {
        const runtime = yield* bundle(
          { strategy: ["baseLocale"] },
          `export * from "./runtime.js";\n`,
        );
        assert.isAtMost(yield* gzipped(runtime), budgets.runtime);
        const full = yield* bundle(
          {
            strategy: [
              "url",
              "cookie",
              "header",
              "preferredLanguage",
              "localStorage",
              "globalVariable",
              "custom-x",
              "baseLocale",
            ],
            url: { pathnames: { "/about": { de: "/ueber-uns" } } },
          },
          `import { items } from "./messages.js";\nexport * from "./runtime.js";\nexport const run = () => items({ count: 2 });\n`,
        );
        assert.include(full, "Artikel");
        assert.notInclude(full, "Besprechung");
        assert.isAtMost(yield* gzipped(full), budgets.pluralWithStrategies);
      }),
    );
  });
});
