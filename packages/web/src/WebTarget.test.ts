import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import { assert, describe, it } from "@effect/vitest";
import { parse } from "@thomasfosterau/effect-l10n/messageformat/Parser";
import { expectGoldenTree } from "@thomasfosterau/effect-l10n-testing";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import ts from "typescript";
import { emit, importFrom, load, writeTree } from "./__fixtures__/harness";
import { compare, reference } from "./__fixtures__/reference";
import { identifierOf, Options } from "./WebTarget";

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const locales = ["en", "fr", "pl", "ar", "cy", "ja"];

const numbers = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 20, 21, 22, 23, 25, 100, 101, 102, 1000000,
  0.5, 1.5,
];

const samples: ReadonlyArray<readonly [string, (n: number) => R.ReadonlyRecord<string, unknown>]> =
  [
    [
      ".input {$count :integer} .match $count 0 {{none}} one {{one: {$count}}} * {{{$count} items}}",
      (count) => ({ count }),
    ],
    [
      ".input {$count :integer} .match $count 1 {{exactly one}} one {{one-ish {$count}}} few {{a few}} * {{other}}",
      (count) => ({ count }),
    ],
    [
      ".input {$count :number} .input {$n :number select=ordinal} .match $count $n one one {{a}} one * {{b}} * two {{c}} * * {{d}}",
      (count) => ({ count, n: Math.floor(count) + 1 }),
    ],
    [
      ".input {$g :string} .input {$count :integer} .match $g $count male one {{he: one}} male * {{he: {$count}}} female * {{she}} * one {{one}} * * {{other}}",
      (count) => ({ count, g: ["male", "female", "x"][count % 3] ?? "x" }),
    ],
    [
      ".local $c = {$count :integer} .match $c * {{{#b}{$c}{/b} at {$d :date length=long}, {$amount :currency currency=EUR}}}",
      (count) => ({ count, d: "2006-01-02", amount: 3.5 }),
    ],
    [
      "Hello, {$name}! {#i}You have{/i} {$count :integer} {$count :percent}",
      (count) => ({ count, name: "Ana" }),
    ],
    [
      ".local $n = {$count :number minimumFractionDigits=2} .local $m = {$n :offset subtract=1} .match $m one {{{$m} more}} * {{{$m :integer} more}}",
      (count) => ({ count }),
    ],
  ];

const app = [
  {
    id: "greeting",
    description: "The dashboard header",
    locales: { en: "Hello, {$name}!", de: "Hallo, {$name}!", ar: "Hello, {$name}!" },
  },
  {
    id: "items",
    locales: {
      en: ".input {$count :integer} .match $count 0 {{No items}} one {{One item}} * {{{$count} items}}",
      de: ".input {$count :integer} .match $count 0 {{Keine Artikel}} one {{Ein Artikel}} * {{{$count} Artikel}}",
      ar: ".input {$count :integer} .match $count 0 {{No items}} one {{One item}} * {{{$count} items}}",
    },
  },
  {
    id: "checkout.total",
    locales: {
      en: "{#b}Total:{/b} {$amount :currency currency=EUR} on {$when :date}",
      de: "{#b}Summe:{/b} {$amount :currency currency=EUR} am {$when :date}",
      ar: "{#b}Total:{/b} {$amount :currency currency=EUR} on {$when :date}",
    },
  },
];

describe("WebTarget", () => {
  it("names exports after message IDs", () => {
    assert.strictEqual(identifierOf("greeting"), "greeting");
    assert.strictEqual(identifierOf("checkout.total_price"), "checkout_totalPrice");
    assert.strictEqual(identifierOf("delete"), "delete_");
  });

  it.effect("rejects the url strategy's domain mode without domains", () =>
    Effect.gen(function* () {
      const decode = Schema.decodeUnknownExit(Options);
      assert.isTrue(Exit.isFailure(decode({ strategy: ["url"], url: { mode: "domain" } })));
      const decoded = yield* Schema.decodeEffect(Options)({});
      assert.deepStrictEqual(decoded.strategy, [
        "cookie",
        "globalVariable",
        "preferredLanguage",
        "baseLocale",
      ]);
      assert.strictEqual(decoded.cookie.name, "l10n-locale");
    }),
  );

  it.layer(Layer.mergeAll(platform, reference))((scoped) => {
    scoped.effect("formats as the reference does in every locale", () =>
      Effect.gen(function* () {
        const { messages } = yield* load(
          Arr.map(samples, ([source], i) => ({
            id: `m${i}`,
            locales: R.fromEntries(Arr.map(locales, (l) => [l, source] as const)),
          })),
        );
        const mismatches = yield* Effect.forEach(
          Arr.flatMap(samples, ([source, paramsOf], i) =>
            Arr.flatMap(locales, (locale) =>
              Arr.map(numbers, (n) => ({ source, id: `m${i}`, locale, params: paramsOf(n) })),
            ),
          ),
          ({ source, id, locale, params }) =>
            Effect.gen(function* () {
              const message = yield* parse(source);
              const compiled = yield* Effect.fromOption(R.get(messages, id));
              const found = yield* compare(message, compiled, locale, params);
              return Option.map(found, (m) => ({ source, locale, params, ...m }));
            }),
          { concurrency: 1 },
        );
        assert.deepStrictEqual(Arr.getSomes(mismatches), []);
      }),
    );

    scoped.effect("emits the golden tree for the app fixture", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const files = yield* emit(app);
        yield* expectGoldenTree(files, path.join(import.meta.dirname, "__golden__", "js"));
        const typescript = yield* emit(app, {
          output: "ts",
          strategy: ["url", "cookie", "header", "localStorage", "custom-session", "baseLocale"],
          url: { pathnames: { "/about": { de: "/ueber-uns" } } },
        });
        yield* expectGoldenTree(typescript, path.join(import.meta.dirname, "__golden__", "ts"));
      }),
    );

    scoped.effect("formats the same from TypeScript output", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const { messages } = yield* load(app);
        const dir = yield* writeTree(yield* emit(app, { output: "ts" }));
        const typed = yield* importFrom<typeof messages>(path.join(dir, "messages.ts"));
        const params = { amount: 12.5, when: "2026-11-25" };
        assert.strictEqual(
          typed["checkout_total"]?.(params, { locale: "de" }),
          messages["checkout_total"]?.(params, { locale: "de" }),
        );
        assert.strictEqual(
          messages["greeting"]?.({ name: "Ana" }, { locale: "en" }),
          "Hello, ⁨Ana⁩!",
        );
      }),
    );

    scoped.effect("types calls exactly, in .d.ts and .ts output", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const check = Effect.fn("check")(function* (options: typeof Options.Encoded) {
          const dir = yield* writeTree({
            ...(yield* emit(app, options)),
            "use.ts": `import { checkout_total, greeting, items } from "./messages.js";
import { setLocale } from "./runtime.js";
greeting({ name: "Ana" });
items({ count: 2 }, { locale: "de" });
checkout_total.parts({ amount: { value: 1, currency: "EUR" }, when: new Date() });
// @ts-expect-error a missing parameter
greeting({});
// @ts-expect-error a parameter of the wrong type
items({ count: "2" });
// @ts-expect-error a locale the project doesn't have
setLocale("fr");
const names = checkout_total
  .parts({ amount: 1, when: 0 })
  .flatMap((p) => (p.type === "markup" ? [p.name] : []));
const exact: Array<"b"> = names;
// @ts-expect-error markup the message doesn't have
const other: Array<"i"> = names;
export { exact, other };
`,
          });
          const program = ts.createProgram([path.join(dir, "use.ts")], {
            strict: true,
            noEmit: true,
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            allowImportingTsExtensions: true,
            lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
            types: [],
          });
          return Arr.map(ts.getPreEmitDiagnostics(program), (d) =>
            ts.flattenDiagnosticMessageText(d.messageText, "\n"),
          );
        });
        assert.deepStrictEqual(yield* check({}), []);
        assert.deepStrictEqual(yield* check({ output: "ts" }), []);
      }),
    );
  });
});
