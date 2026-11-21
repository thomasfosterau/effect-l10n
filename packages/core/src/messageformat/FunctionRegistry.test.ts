import { assert, describe, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { add, defaults, DraftFunctions, FunctionRegistry, get, lookup } from "./FunctionRegistry";
import { testFunctions } from "./internal/testFunctions";
import * as MessageFunction from "./MessageFunction";
import type { MessageValue } from "./MessageValue";

const intl = MessageFunction.makeIntlCache();

const registry = FunctionRegistry.of({
  functions: R.fromEntries(Arr.map([...defaults, ...testFunctions], (fn) => [fn.name, fn])),
});

const fn = (name: string): MessageFunction.MessageFunction =>
  Option.match(lookup(registry, name, true), {
    onNone: () => assert.fail(`no function ${name}`),
    onSome: (registered) => registered,
  });

/** An operand value, as a literal or an input variable could hold it. */
type Operand =
  | string
  | number
  | boolean
  | { readonly value: number; readonly currency?: string; readonly unit?: string };

/** An unannotated operand. */
const input = (value: Operand): MessageValue => ({
  type: "input",
  locale: "en-US",
  dir: "auto",
  value,
  options: {},
  format: Option.none(),
  select: Option.none(),
});

/** An option's value: a literal's string, or `{ variable }` for a variable's value. */
type Option_ = string | { readonly variable: string | number };

interface Called {
  readonly value: Option.Option<MessageValue>;
  readonly codes: ReadonlyArray<string>;
}

const call = (
  name: string,
  operand: Option.Option<MessageValue>,
  options: Readonly<Record<string, Option_>>,
  locale: string,
  called: MessageFunction.MessageFunction = fn(name),
): Called => {
  const resolution = called.call({
    context: { locale, intl },
    operand,
    options: R.map(options, (value) =>
      P.isString(value) ? { value, literal: true } : { value: value.variable, literal: false },
    ),
  });
  return { value: resolution.value, codes: Arr.map(resolution.errors, (error) => error.code) };
};

const isValue = (operand: Operand | MessageValue): operand is MessageValue =>
  P.isObject(operand) && "select" in operand;

/** Calls a function on an operand value, or on an earlier call's result. */
const apply = (
  name: string,
  operand: Operand | MessageValue,
  options: Readonly<Record<string, Option_>> = {},
  locale = "en-US",
): Called => call(name, Option.some(isValue(operand) ? operand : input(operand)), options, locale);

const selection = (matches: ReadonlyArray<string>, errors: ReadonlyArray<string>) =>
  Option.some({ matches, errors });

const resolved = (called: Called): MessageValue =>
  Option.match(called.value, {
    onNone: () => assert.fail(`no value: ${Arr.join(called.codes, ", ")}`),
    onSome: (value) => value,
  });

const format = (called: Called): string =>
  Option.match(resolved(called).format, {
    onNone: () => "<unformattable>",
    onSome: (formatter) =>
      Result.match(formatter(), {
        onFailure: () => "<failed>",
        onSuccess: (formatted) => formatted.value,
      }),
  });

const select = (called: Called, keys: ReadonlyArray<string>) =>
  Option.flatMap(resolved(called).select, (selector) =>
    Result.getSuccess(selector(keys)).pipe(
      Option.map(({ matches, errors }) => ({
        matches,
        errors: Arr.map(errors, (error) => error.code),
      })),
    ),
  );

describe(":number", () => {
  it.each([
    ["4.2", "4.2"],
    ["-4.20", "-4.2"],
    ["0.42e+1", "4.2"],
    [4.2, "4.2"],
    [1234.5, "1,234.5"],
  ])("formats %j as %j", (operand, expected) => {
    assert.strictEqual(format(apply("number", operand)), expected);
  });

  it.each([
    ["00"],
    ["042"],
    ["1."],
    [".1"],
    ["+1"],
    ["0x1"],
    ["1e"],
    ["foo"],
    [true],
    [Number.NaN],
  ])("rejects the operand %j", (operand) => {
    const called = apply("number", operand);
    assert.isTrue(Option.isNone(called.value));
    assert.deepStrictEqual(called.codes, ["bad-operand"]);
  });

  it("rejects a missing operand", () => {
    assert.deepStrictEqual(call("number", Option.none(), {}, "en-US").codes, ["bad-operand"]);
  });

  it("decodes options from literals and variables", () => {
    assert.strictEqual(format(apply("number", 4.2, { minimumFractionDigits: "2" })), "4.20");
    assert.strictEqual(
      format(apply("number", 4.2, { minimumFractionDigits: { variable: 2 } })),
      "4.20",
    );
    assert.strictEqual(format(apply("number", 1234, { useGrouping: "never" })), "1234");
    assert.strictEqual(format(apply("number", 42, { signDisplay: "always" })), "+42");
  });

  it("ignores an option it can't decode", () => {
    const called = apply("number", 4.2, { minimumFractionDigits: "foo" });
    assert.deepStrictEqual(called.codes, ["bad-option"]);
    assert.strictEqual(format(called), "4.2");
  });

  it("formats to Intl parts", () => {
    const parts = Option.flatMap(resolved(apply("number", 42)).format, (formatter) =>
      Option.flatMap(Result.getSuccess(formatter()), (value) =>
        Option.fromUndefinedOr(value.parts),
      ),
    );
    assert.deepStrictEqual(parts, Option.some([{ type: "integer", value: "42" }]));
  });

  it("selects an exact match before a plural category", () => {
    assert.deepStrictEqual(
      select(apply("number", 1), ["one", "1", "other", "2"]),
      selection(["1", "one"], []),
    );
    assert.deepStrictEqual(select(apply("number", 5), ["one", "other"]), selection(["other"], []));
    assert.deepStrictEqual(
      select(apply("number", 2, {}, "pl"), ["one", "few", "many"]),
      selection(["few"], []),
    );
  });

  it("reports keys that are neither numbers nor categories", () => {
    assert.deepStrictEqual(
      select(apply("number", 1), ["horse", "1"]),
      selection(["1"], ["bad-variant-key"]),
    );
  });

  it("selects by select=ordinal and select=exact", () => {
    assert.deepStrictEqual(
      select(apply("number", 2, { select: "ordinal" }), ["two", "other"]),
      selection(["two"], []),
    );
    assert.deepStrictEqual(
      select(apply("number", 1, { select: "exact" }), ["one", "1"]),
      selection(["1"], []),
    );
  });

  it("serializes fractional exact keys with their digit options", () => {
    assert.deepStrictEqual(
      select(apply("number", 1, { minimumFractionDigits: "1" }), ["1", "1.0"]),
      selection(["1.0"], []),
    );
  });

  it("can't select when a variable sets select", () => {
    const called = apply("number", 1, { select: { variable: "exact" } });
    assert.deepStrictEqual(called.codes, ["bad-option"]);
    assert.strictEqual(format(called), "1");
    assert.isTrue(Option.isNone(resolved(called).select));
  });

  it("inherits its operand's options, but not select", () => {
    const first = resolved(apply("number", 4.2, { minimumFractionDigits: "2" }));
    assert.strictEqual(format(apply("number", first)), "4.20");
    assert.strictEqual(format(apply("number", first, { minimumFractionDigits: "1" })), "4.2");
    const exact = resolved(apply("number", 1, { select: "exact" }));
    const called = apply("number", exact);
    assert.deepStrictEqual(called.codes, ["bad-option"]);
    assert.isTrue(Option.isNone(resolved(called).select));
  });
});

describe(":integer", () => {
  it.each([
    ["4.2", "4"],
    ["-4.20", "-4"],
    ["0.42", "0"],
    ["0.42e+1", "4"],
  ])("formats %j as %j", (operand, expected) => {
    assert.strictEqual(format(apply("integer", operand)), expected);
  });

  it("selects on the integer part", () => {
    assert.deepStrictEqual(
      select(apply("integer", 1.2), ["1", "one"]),
      selection(["1", "one"], []),
    );
  });

  it("passes its truncated value on", () => {
    assert.strictEqual(format(apply("number", resolved(apply("integer", 1.25)))), "1");
  });
});

describe(":offset", () => {
  it("adds or subtracts", () => {
    assert.strictEqual(format(apply("offset", 41, { add: "1" })), "42");
    assert.strictEqual(format(apply("offset", 52, { subtract: "10" })), "42");
  });

  it.each([[{}], [{ add: "13", subtract: "13" }], [{ add: "foo" }], [{ foo: "13" }]])(
    "reports one bad option for %j",
    (options) => {
      const called = apply("offset", 42, options);
      assert.isTrue(Option.isNone(called.value));
      assert.deepStrictEqual(called.codes, ["bad-option"]);
    },
  );

  it("formats as its operand did", () => {
    const integer = resolved(apply("integer", 41, { signDisplay: "always" }));
    assert.strictEqual(format(apply("offset", integer, { add: "1" })), "+42");
  });

  it("selects by plural rules on the new value", () => {
    const value = resolved(apply("integer", 10));
    assert.deepStrictEqual(
      select(apply("offset", value, { subtract: "6" }), ["10", "4"]),
      selection(["4"], []),
    );
  });
});

describe(":percent", () => {
  it("formats and selects on the value times 100", () => {
    assert.strictEqual(format(apply("percent", 0.12)), "12%");
    assert.strictEqual(format(apply("percent", 0.12345, { maximumFractionDigits: "1" })), "12.3%");
    assert.deepStrictEqual(
      select(apply("percent", 0.01), ["one", "1", "100"]),
      selection(["1", "one"], []),
    );
  });
});

describe(":currency", () => {
  it("needs a currency", () => {
    assert.deepStrictEqual(apply("currency", 42).codes, ["bad-operand"]);
    assert.deepStrictEqual(apply("currency", resolved(apply("number", 42))).codes, ["bad-operand"]);
  });

  it("formats an amount", () => {
    assert.strictEqual(format(apply("currency", 42, { currency: "EUR" })), "€42.00");
    assert.strictEqual(format(apply("currency", 42, { currency: "eur" })), "€42.00");
    assert.strictEqual(
      format(apply("currency", 42, { currency: "EUR", fractionDigits: "0" })),
      "€42",
    );
    assert.strictEqual(
      format(apply("currency", 42, { currency: "EUR", currencyDisplay: "never" })),
      "42.00",
    );
  });

  it("takes the currency from an amount or an earlier :currency", () => {
    assert.strictEqual(format(apply("currency", { value: 42, currency: "USD" })), "$42.00");
    assert.deepStrictEqual(
      apply("currency", { value: 42, currency: "USD" }, { currency: "EUR" }).codes,
      ["bad-option"],
    );
    const euros = resolved(apply("currency", 42, { currency: "EUR" }));
    assert.strictEqual(format(apply("currency", euros)), "€42.00");
  });

  it("can't select", () => {
    assert.isTrue(Option.isNone(resolved(apply("currency", 42, { currency: "EUR" })).select));
  });
});

describe(":unit", () => {
  it("formats a measurement", () => {
    assert.strictEqual(format(apply("unit", 42, { unit: "kilometer" })), "42 km");
    assert.strictEqual(
      format(apply("unit", { value: 3, unit: "hour" }, { unitDisplay: "long" })),
      "3 hours",
    );
  });

  it("reports what it can't do", () => {
    assert.deepStrictEqual(apply("unit", 42).codes, ["bad-operand"]);
    assert.deepStrictEqual(apply("unit", 42, { unit: "meter", usage: "road" }).codes, [
      "unsupported-operation",
    ]);
    assert.strictEqual(format(apply("unit", 42, { unit: "furlong" })), "<failed>");
  });
});

describe(":string", () => {
  it("formats its operand as a string", () => {
    assert.strictEqual(format(apply("string", "foo")), "foo");
    assert.strictEqual(format(apply("string", 42)), "42");
    assert.deepStrictEqual(apply("string", { value: 1 }).codes, ["bad-operand"]);
  });

  it("selects by NFC equality", () => {
    const decomposed = "Ḍ̇";
    assert.deepStrictEqual(select(apply("string", decomposed), ["Ḍ̇", "x"]), selection(["Ḍ̇"], []));
  });
});

// ICU versions differ on whether a narrow no-break space precedes "PM".
const spaced = (text: string) => text.replaceAll("\u202f", " ");

describe("date and time", () => {
  const instant = "2006-01-02T15:04:06";

  it("formats date/time literals in floating time", () => {
    assert.strictEqual(spaced(format(apply("datetime", instant))), "Jan 2, 2006, 3:04 PM");
    assert.strictEqual(
      spaced(format(apply("datetime", instant, { dateLength: "long", timePrecision: "second" }))),
      "January 2, 2006 at 3:04:06 PM",
    );
    assert.strictEqual(format(apply("date", "2006-01-02", { length: "long" })), "January 2, 2006");
    assert.strictEqual(format(apply("date", instant, { length: "short" })), "1/2/2006");
    assert.strictEqual(
      spaced(format(apply("time", instant, { precision: "second" }))),
      "3:04:06 PM",
    );
  });

  it("applies override options", () => {
    assert.strictEqual(
      format(apply("time", "2006-01-02T15:04:06Z", { timeZone: "UTC", hour12: "false" })),
      "15:04",
    );
    assert.deepStrictEqual(apply("time", instant, { timeZone: "Not/A_Zone" }).codes, [
      "bad-option",
    ]);
  });

  it("inherits only the override options", () => {
    const value = resolved(
      apply("datetime", instant, { timePrecision: "second", hour12: "false" }),
    );
    assert.strictEqual(format(apply("time", value)), "15:04");
  });

  it.each([["horse"], [true], ["2006-13-01"]])("rejects the operand %j", (operand) => {
    assert.deepStrictEqual(apply("datetime", operand).codes, ["bad-operand"]);
  });

  it("requires literal style options", () => {
    const called = apply("date", instant, { length: { variable: "long" } });
    assert.deepStrictEqual(called.codes, ["bad-option"]);
    assert.strictEqual(format(called), "Jan 2, 2006");
  });

  it("can't select", () => {
    assert.isTrue(Option.isNone(resolved(apply("date", instant)).select));
  });
});

const Gender = Schema.Literals(["masculine", "feminine", "other"]);

// A custom selector whose operand and options are typed by their schemas.
const gender = MessageFunction.make({
  name: "ns:gender",
  operand: Gender,
  options: { fallback: Gender },
  resolve: ({ context, operand, options }) => {
    const value: typeof Gender.Type = operand;
    const fallback: Option.Option<typeof Gender.Type> = Option.fromUndefinedOr(options.fallback);
    return Result.succeed({
      type: "gender",
      locale: context.locale,
      dir: "auto",
      value,
      options: {},
      format: Option.none(),
      select: Option.some((keys: ReadonlyArray<string>) =>
        Result.succeed({
          matches: Arr.filter(keys, (key) => key === value || Option.contains(fallback, key)),
          errors: [],
        }),
      ),
    });
  },
});

describe("FunctionRegistry", () => {
  it.layer(FunctionRegistry.layer)("defaults", (scoped) => {
    scoped.effect("hides draft functions unless DraftFunctions is on", () =>
      Effect.gen(function* () {
        assert.isTrue(Option.isSome(yield* get("number")));
        assert.isTrue(Option.isNone(yield* get("datetime")));
        const draft = yield* get("datetime").pipe(Effect.provideService(DraftFunctions, true));
        assert.isTrue(Option.isSome(draft));
      }),
    );
  });

  it.layer(add(gender).pipe(Layer.provide(FunctionRegistry.layer)))("custom", (scoped) => {
    scoped.effect("adds functions by composing layers", () =>
      Effect.gen(function* () {
        assert.isTrue(Option.isSome(yield* get("string")));
        const found = yield* get("ns:gender");
        const custom = Option.match(found, {
          onNone: () => assert.fail("ns:gender is missing"),
          onSome: (registered) => registered,
        });
        const called = call("ns:gender", Option.some(input("feminine")), {}, "en", custom);
        assert.deepStrictEqual(select(called, ["feminine", "other"]), selection(["feminine"], []));
      }),
    );
  });

  it("types a custom function's operand", () => {
    const operand: Schema.ConstraintDecoder<typeof Gender.Type> = gender.operand;
    assert.strictEqual(operand, Gender);
    const called = call("ns:gender", Option.some(input("neuter")), {}, "en", gender);
    assert.deepStrictEqual(called.codes, ["bad-operand"]);
  });
});

describe("test functions", () => {
  it("format and select as the conformance suite defines", () => {
    assert.strictEqual(format(apply("test:function", -1.25, { decimalPlaces: "1" })), "-1.2");
    assert.deepStrictEqual(
      select(apply("test:select", 1, { decimalPlaces: "1" }), ["1", "1.0", "2"]),
      selection(["1.0", "1"], []),
    );
    assert.isTrue(Option.isNone(resolved(apply("test:select", 1)).format));
    assert.isTrue(Option.isNone(resolved(apply("test:format", 1)).select));
  });

  it("fall back on a bad decimalPlaces, reporting it once", () => {
    const called = apply("test:function", 1, { decimalPlaces: "9" });
    assert.isTrue(Option.isNone(called.value));
    assert.deepStrictEqual(called.codes, ["bad-option"]);
  });
});
