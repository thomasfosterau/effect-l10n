import { assert, describe, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import { Locale } from "../Locale";
import * as DataModel from "../messageformat/DataModel";
import { Formatter } from "../messageformat/Formatter";
import { FunctionRegistry } from "../messageformat/FunctionRegistry";
import type { ResolvedOptions } from "../messageformat/MessageValue";
import { parse } from "../messageformat/Parser";
import * as Ir from "./Ir";
import {
  type Capabilities,
  expandCategories,
  type Lowered,
  lowerLocale,
  type TargetInfo,
} from "./Lowering";
import * as Plan from "./Plan";

const tag = Schema.decodeSync(Locale);

const layer = Formatter.layer.pipe(Layer.provide(FunctionRegistry.layer));

const all: Capabilities = {
  selectors: "any",
  hasExactKeys: true,
  functions: "all",
  markup: "keep",
  hasAccessors: true,
};

const plural: Capabilities = {
  selectors: "plural",
  maxSelectors: 1,
  hasExactKeys: false,
  functions: ["string", "integer", "number"],
  markup: "strip",
  hasAccessors: true,
};

const targets: R.ReadonlyRecord<string, Capabilities> = {
  any: all,
  plural,
  "plural with exact keys": {
    selectors: "plural",
    hasExactKeys: true,
    functions: ["integer"],
    markup: "keep",
    hasAccessors: true,
  },
  none: {
    selectors: "none",
    hasExactKeys: false,
    functions: [],
    markup: "strip",
    hasAccessors: true,
  },
};

const locales = ["en", "fr", "pl", "ar", "cy", "ja"];

const numbers = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 20, 21, 22, 23, 25, 100, 101, 102, 1000000,
  0.5, 1.5,
];

const exactAndCategories =
  ".input {$count :integer} .match $count 1 {{exactly one}} one {{one-ish {$count}}} few {{a few}} * {{other}}";

const stringByPlural =
  ".input {$g :string} .input {$count :integer} .match $g $count male one {{he: one}} male * {{he: {$count}}} female * {{she}} * one {{one}} * * {{other}}";

const formatted =
  ".local $c = {$count :integer} .match $c * {{{#b}{$c}{/b} at {$d :date length=long}, {$amount :currency currency=EUR}}}";

const messages: ReadonlyArray<readonly [string, (n: number) => ResolvedOptions]> = [
  [
    ".input {$count :integer} .match $count 0 {{none}} one {{one: {$count}}} * {{{$count} items}}",
    (count) => ({ count }),
  ],
  [exactAndCategories, (count) => ({ count })],
  [
    ".input {$count :number} .input {$n :number select=ordinal} .match $count $n one one {{a}} one * {{b}} * two {{c}} * * {{d}}",
    (count) => ({ count, n: Math.floor(count) + 1 }),
  ],
  [
    stringByPlural,
    (count) => ({
      count,
      g: Arr.get(["male", "female", "x"], count % 3).pipe(Option.getOrElse(() => "x")),
    }),
  ],
  [formatted, (count) => ({ count, d: "2006-01-02", amount: 3.5 })],
  [
    "Hello, {$name}! {#i}You have{/i} {$count :integer} {$count :percent}",
    (count) => ({ count, name: "Ana" }),
  ],
];

/** How the reference formatter ranks a switch's keys: its best, repeatedly. */
const matcher =
  (
    formatter: Formatter["Service"],
    message: DataModel.Message,
    locale: string,
    params: ResolvedOptions,
  ): Plan.Matcher =>
  (node, keys) => {
    const ranked = (left: ReadonlyArray<string>): ReadonlyArray<string> => {
      const select = new DataModel.SelectMessage({
        declarations: message.declarations,
        selectors: [new DataModel.VariableRef({ name: node.selector })],
        variants: [
          new DataModel.Variant({ keys: [new DataModel.CatchallKey({})], value: ["*"] }),
          ...Arr.map(
            left,
            (key) =>
              new DataModel.Variant({
                keys: [new DataModel.Literal({ value: key })],
                value: [key],
              }),
          ),
        ],
      });
      const best = formatter.formatToString(select, {
        locale,
        params,
        bidiIsolation: "none",
      }).value;
      return best === "*" ? [] : [best, ...ranked(Arr.filter(left, (k) => k !== best))];
    };
    return ranked(keys);
  };

const format = (
  formatter: Formatter["Service"],
  declarations: ReadonlyArray<DataModel.Declaration>,
  pattern: DataModel.Pattern,
  locale: string,
  params: ResolvedOptions,
) =>
  formatter.formatToString(new DataModel.PatternMessage({ declarations, pattern }), {
    locale,
    params,
    bidiIsolation: "none",
  }).value;

const irMessage = (source: string, locale: string, model: DataModel.Message) =>
  new Ir.Message({
    id: "m",
    doNotTranslate: false,
    params: [],
    locales: {
      [locale]: new Ir.LocaleMessage({
        locale: tag(locale),
        from: tag(locale),
        source,
        message: model,
      }),
    },
  });

const localeMessage = (source: string, locale: string, model: DataModel.Message) =>
  new Ir.LocaleMessage({ locale: tag(locale), from: tag(locale), source, message: model });

const lowerFor = (source: string, locale: string, target: TargetInfo) =>
  Effect.map(parse(source), (model) =>
    lowerLocale(irMessage(source, locale, model), localeMessage(source, locale, model), target),
  );

/** Formats `source` in `locale` from its lowered plan, as a target would. */
const formatLowered = (
  formatter: Formatter["Service"],
  model: DataModel.Message,
  lowered: Lowered,
  locale: string,
  params: ResolvedOptions,
) => {
  const pattern = Plan.evaluate(lowered.plan, matcher(formatter, model, locale, params));
  const preformatted = R.fromEntries(
    Arr.map(lowered.preformat, (p) => [
      p.name,
      format(formatter, lowered.declarations, [p.expression], locale, params),
    ]),
  );
  return Option.map(pattern, (found) =>
    format(formatter, lowered.declarations, found, locale, { ...params, ...preformatted }),
  );
};

const cases = Arr.flatMap(messages, ([source, paramsOf]) =>
  Arr.flatMap(locales, (locale) => Arr.map(numbers, (n) => [source, locale, paramsOf(n)] as const)),
);

describe("lowering", () => {
  it("samples every plural category of every test locale", () => {
    const missing = Arr.flatMap(locales, (locale) =>
      Arr.flatMap(["cardinal", "ordinal"] as const, (type) => {
        const rules = new Intl.PluralRules(locale, { type });
        const hit = Arr.map(numbers, (n) => rules.select(n));
        return Arr.map(
          Arr.difference(rules.resolvedOptions().pluralCategories, hit),
          (category) => `${locale} ${type} ${category}`,
        );
      }),
    );
    assert.deepStrictEqual(missing, []);
  });

  it.layer(layer)((scoped) => {
    Arr.forEach(R.toEntries(targets), ([target, capabilities]) =>
      scoped.effect(`keeps every message's output for a ${target} target`, () =>
        Effect.gen(function* () {
          const formatter = yield* Formatter;
          const results = yield* Effect.forEach(
            cases,
            Effect.fnUntraced(function* ([source, locale, params]) {
              const model = yield* parse(source);
              const [lowered, diagnostics] = yield* lowerFor(source, locale, {
                name: target,
                capabilities,
              });
              const options = { locale, params, bidiIsolation: "none" } as const;
              const expected = formatter.formatToString(model, options).value;
              const actual = formatLowered(formatter, model, lowered, locale, params);
              return {
                at: `${source} in ${locale} with ${String(params["count"])}`,
                diagnostics: diagnostics.length,
                matches: Option.contains(actual, expected),
              };
            }),
            { concurrency: 1 },
          );
          assert.deepStrictEqual(
            Arr.filter(results, (r) => r.diagnostics > 0 || !r.matches),
            [],
          );
        }),
      ),
    );
  });

  it.effect("expands a plural switch into the locale's categories after its exact keys", () =>
    Effect.gen(function* () {
      const plan = Plan.fromMessage(yield* parse(exactAndCategories));
      assert.instanceOf(plan, Plan.Switch);
      const expanded = expandCategories(plan, "en");
      assert.instanceOf(expanded, Plan.Chain);
      const [exact, categories] = expanded.plans;
      assert.instanceOf(exact, Plan.Switch);
      assert.instanceOf(categories, Plan.Switch);
      assert.deepStrictEqual(
        [exact.kind, Arr.map(exact.cases, (c) => c.key), Arr.map(categories.cases, (c) => c.key)],
        ["exact", ["1"], ["one", "other"]],
      );
    }),
  );

  it.effect("places what the resources can't hold in the accessor", () =>
    Effect.gen(function* () {
      const [lowered] = yield* lowerFor(stringByPlural, "en", {
        name: "plural",
        capabilities: plural,
      });
      assert.instanceOf(lowered.plan, Plan.Switch);
      assert.deepStrictEqual([lowered.plan.selector, lowered.plan.at], ["g", "accessor"]);
    }),
  );

  it.effect("reports what a target without accessors can't express", () =>
    Effect.gen(function* () {
      const [, diagnostics] = yield* lowerFor(formatted, "en", {
        name: "strings",
        capabilities: {
          selectors: "none",
          hasExactKeys: false,
          functions: [],
          markup: "strip",
          hasAccessors: false,
        },
      });
      assert.deepStrictEqual(
        Arr.map(diagnostics, (d) => [d.code, d.message, d.messageId, d.locale]),
        [
          [
            "unsupported-feature",
            "The strings target can't express selection on $c with :integer",
            "m",
            "en",
          ],
          [
            "unsupported-feature",
            "The strings target can't express :integer formatting",
            "m",
            "en",
          ],
          ["unsupported-feature", "The strings target can't express :date formatting", "m", "en"],
          [
            "unsupported-feature",
            "The strings target can't express :currency formatting",
            "m",
            "en",
          ],
        ],
      );
    }),
  );
});
