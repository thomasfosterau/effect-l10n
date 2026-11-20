import { assert, describe, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import bidi from "./__conformance__/bidi.json" with { type: "json" };
import dataModelErrors from "./__conformance__/data-model-errors.json" with { type: "json" };
import fallback from "./__conformance__/fallback.json" with { type: "json" };
import currency from "./__conformance__/functions/currency.json" with { type: "json" };
import date from "./__conformance__/functions/date.json" with { type: "json" };
import datetime from "./__conformance__/functions/datetime.json" with { type: "json" };
import integer from "./__conformance__/functions/integer.json" with { type: "json" };
import number from "./__conformance__/functions/number.json" with { type: "json" };
import offset from "./__conformance__/functions/offset.json" with { type: "json" };
import percent from "./__conformance__/functions/percent.json" with { type: "json" };
import string from "./__conformance__/functions/string.json" with { type: "json" };
import time from "./__conformance__/functions/time.json" with { type: "json" };
import patternSelection from "./__conformance__/pattern-selection.json" with { type: "json" };
import syntaxErrors from "./__conformance__/syntax-errors.json" with { type: "json" };
import syntax from "./__conformance__/syntax.json" with { type: "json" };
import uOptions from "./__conformance__/u-options.json" with { type: "json" };
import { Formatter, formatToParts, formatToString, type Part } from "./Formatter";
import { add, DraftFunctions, FunctionRegistry } from "./FunctionRegistry";
import { testFunctions } from "./internal/testFunctions";
import type { ResolvedOptions } from "./MessageValue";
import { parseResult } from "./Parser";

const Properties = {
  locale: Schema.optionalKey(Schema.String),
  bidiIsolation: Schema.optionalKey(Schema.Literals(["default", "none"])),
  params: Schema.optionalKey(
    Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.Unknown })),
  ),
  exp: Schema.optionalKey(Schema.String),
  expParts: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  expErrors: Schema.optionalKey(Schema.Array(Schema.Struct({ type: Schema.String }))),
};

const Suite = Schema.Struct({
  defaultTestProperties: Schema.optionalKey(Schema.Struct(Properties)),
  tests: Schema.Array(Schema.Struct({ src: Schema.String, ...Properties })),
});

const suites: ResolvedOptions = {
  "syntax.json": syntax,
  "syntax-errors.json": syntaxErrors,
  "data-model-errors.json": dataModelErrors,
  "bidi.json": bidi,
  "fallback.json": fallback,
  "pattern-selection.json": patternSelection,
  "u-options.json": uOptions,
  "functions/currency.json": currency,
  "functions/date.json": date,
  "functions/datetime.json": datetime,
  "functions/integer.json": integer,
  "functions/number.json": number,
  "functions/offset.json": offset,
  "functions/percent.json": percent,
  "functions/string.json": string,
  "functions/time.json": time,
};

const cases = Arr.flatMap(R.toEntries(suites), ([file, json]) => {
  const suite = Schema.decodeUnknownSync(Suite)(json);
  return Arr.map(suite.tests, (test) => ({
    name: `${file}: ${test.src}`,
    test: { ...suite.defaultTestProperties, ...test },
  }));
});

/** A part as the suite writes it: `Option` fields set or left out. */
const plain = (part: Part): ResolvedOptions => {
  const fields: ResolvedOptions = { ...part };
  return R.getSomes(
    R.map(fields, (value: Json) => (Option.isOption(value) ? value : Option.some<Json>(value))),
  );
};

/** Whether `actual` has every field `expected` has, recursively. */
type Json = ResolvedOptions[string];

const matches = (expected: Json, actual: Json): boolean => {
  if (Arr.isArray(expected)) {
    return (
      Arr.isArray(actual) &&
      expected.length === actual.length &&
      Arr.every(expected, (item, i) => matches(item, actual[i]))
    );
  }
  if (P.isObject(expected)) {
    return (
      P.isObject(actual) &&
      Arr.every(R.toEntries(expected), ([key, value]) => matches(value, actual[key]))
    );
  }
  return expected === actual;
};

const conformance = add(...testFunctions).pipe(
  Layer.provide(FunctionRegistry.layer),
  (registry) => Formatter.layer.pipe(Layer.provide(registry)),
  Layer.provide(Layer.succeed(DraftFunctions, true)),
);

describe("conformance", () => {
  it.layer(conformance)((scoped) => {
    scoped.effect.each(cases)("$name", ({ test }) =>
      Effect.gen(function* () {
        const options = {
          locale: test.locale ?? "en-US",
          bidiIsolation: test.bidiIsolation ?? "none",
          params: R.fromEntries(Arr.map(test.params ?? [], ({ name, value }) => [name, value])),
        };
        const parsed = parseResult(test.src);
        if (Result.isFailure(parsed)) {
          assert.deepStrictEqual(
            [parsed.failure.reason.code],
            Arr.map(test.expErrors ?? [], ({ type }) => type),
          );
          return;
        }
        const formatted = yield* formatToString(parsed.success, options);
        assert.deepStrictEqual(
          Arr.map(formatted.errors, (error) => error.code),
          Arr.map(test.expErrors ?? [], ({ type }) => type),
        );
        if (test.exp !== undefined) assert.strictEqual(formatted.value, test.exp);
        if (test.expParts !== undefined) {
          const parts = yield* formatToParts(parsed.success, options);
          const actual = Arr.map(parts.value, plain);
          assert.isTrue(matches(test.expParts, actual));
        }
      }),
    );
  });
});

const parse = (source: string) =>
  Result.match(parseResult(source), {
    onFailure: (error) => assert.fail(error.message),
    onSuccess: (message) => message,
  });

const format = (source: string, params: Record<string, string | number> = {}, locale = "en") =>
  Effect.gen(function* () {
    const formatted = yield* formatToString(parse(source), { locale, params });
    return {
      value: formatted.value,
      errors: Arr.map(formatted.errors, (error) => error.code),
    };
  });

describe("Formatter", () => {
  it.layer(Formatter.layer.pipe(Layer.provide(FunctionRegistry.layer)))((scoped) => {
    scoped.effect("isolates placeholders by default", () =>
      Effect.gen(function* () {
        assert.deepStrictEqual(yield* format("Hi {$name}!", { name: "Ali" }), {
          value: "Hi ⁨Ali⁩!",
          errors: [],
        });
        assert.deepStrictEqual(yield* format("{$n} items", { n: 3 }), {
          value: "3 items",
          errors: [],
        });
        assert.deepStrictEqual(yield* format("{$n} عناصر", { n: 3 }, "ar"), {
          value: "\u20673\u2069 عناصر",
          errors: [],
        });
      }),
    );

    scoped.effect("selects a plural variant", () =>
      Effect.gen(function* () {
        const source = ".input {$n :number} .match $n 0 {{none}} one {{one}} * {{{$n} items}}";
        assert.strictEqual((yield* format(source, { n: 0 })).value, "none");
        assert.strictEqual((yield* format(source, { n: 1 })).value, "one");
        assert.strictEqual((yield* format(source, { n: 1500 })).value, "1,500 items");
      }),
    );

    scoped.effect("reads other variables in an .input's options", () =>
      Effect.gen(function* () {
        const source = ".input {$n :number minimumFractionDigits=$digits} {{{$n}}}";
        assert.strictEqual((yield* format(source, { n: 1, digits: 2 })).value, "1.00");
      }),
    );

    scoped.effect("leaves draft functions out unless enabled", () =>
      Effect.gen(function* () {
        assert.deepStrictEqual(yield* format("{|2006-01-02| :date}"), {
          value: "\u2068{|2006-01-02|}\u2069",
          errors: ["unknown-function"],
        });
      }),
    );

    scoped.effect("falls back for a message with data model errors", () =>
      Effect.gen(function* () {
        assert.deepStrictEqual(yield* format(".input {$x} .match $x * {{}}"), {
          value: "{�}",
          errors: ["missing-selector-annotation"],
        });
      }),
    );

    scoped.effect("formats markup as parts and as nothing in a string", () =>
      Effect.gen(function* () {
        const parts = yield* formatToParts(parse("{#b u:id=x}bold{/b}"), { locale: "en" });
        assert.deepStrictEqual(Arr.map(parts.value, plain), [
          { type: "markup", kind: "open", name: "b", options: {}, id: "x" },
          { type: "text", value: "bold" },
          { type: "markup", kind: "close", name: "b", options: {} },
        ]);
        assert.strictEqual((yield* format("{#b}bold{/b}")).value, "bold");
      }),
    );
  });
});
