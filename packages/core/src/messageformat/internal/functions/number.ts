import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import {
  BadOperand,
  BadOption,
  BadVariantKey,
  UnsupportedOperation,
} from "../../MessageFormatError";
import * as MessageFunction from "../../MessageFunction";
import type { FormattedPart, MessageValue, ResolvedOptions } from "../../MessageValue";
import { localeDirection } from "../locale";
import { DigitSize, Numeric, numberLiteral, numberOptions, Select } from "../options";

type NumberOptions = MessageFunction.OptionsOf<typeof numberOptions>;

const keywords = ["zero", "one", "two", "few", "many", "other"];

// Options that make the exact-match key of an integer implementation-defined.
const digitOptions = [
  "minimumIntegerDigits",
  "minimumFractionDigits",
  "minimumSignificantDigits",
  "maximumSignificantDigits",
] as const;

/** The `Intl.NumberFormat` options for decoded MF2 number options. */
const intlOptions = (options: NumberOptions): Intl.NumberFormatOptions => {
  const { useGrouping, ...rest } = options;
  return useGrouping === undefined
    ? rest
    : { ...rest, useGrouping: useGrouping === "never" ? false : useGrouping };
};

const decodeNumberOptions = R.map(numberOptions, (codec) => Schema.decodeUnknownOption(codec));

/** An earlier number function's resolved options, as this one reads them. */
const numberOptionsOf = (argument: Option.Option<MessageValue>): NumberOptions =>
  Option.match(argument, {
    onNone: () => ({}),
    onSome: (value) =>
      R.getSomes(R.map(decodeNumberOptions, (decode, name) => decode(value.options[name]))),
  });

interface NumberValue {
  readonly name: string;
  readonly type: string;
  readonly context: MessageFunction.FunctionContext;
  readonly value: Numeric;
  /** What the value formats as, if not `value`. */
  readonly formatted?: number;
  /** What the value selects on, if not `value`. */
  readonly selected?: number;
  readonly options: ResolvedOptions;
  readonly format: Intl.NumberFormatOptions;
  /** How it selects, or none if it can't. */
  readonly select: Option.Option<Select>;
  /** Parts left out of the formatted value. */
  readonly hide: (part: FormattedPart) => boolean;
}

const unsupported = (name: string) => () =>
  new UnsupportedOperation({ function: name, operation: "these options" });

const exactKey = (spec: NumberValue, value: number): Result.Result<string, unknown> =>
  Number.isInteger(value) && Arr.every(digitOptions, (name) => spec.format[name] === undefined)
    ? Result.succeed(BigInt(value).toString())
    : Result.map(
        spec.context.intl.numberFormat("en", {
          ...Struct.pick(spec.format, [
            ...digitOptions,
            "maximumFractionDigits",
            "roundingPriority",
            "roundingIncrement",
            "roundingMode",
            "trailingZeroDisplay",
          ]),
          useGrouping: false,
        }),
        (format) => format.format(value),
      );

const selectKeys = (spec: NumberValue, mode: Select, keys: ReadonlyArray<string>) => {
  const value = spec.selected ?? spec.value;
  const keyword =
    mode === "exact"
      ? Result.succeed("")
      : Result.map(
          spec.context.intl.pluralRules(spec.context.locale, {
            ...spec.format,
            type: mode === "ordinal" ? "ordinal" : "cardinal",
          }),
          (rules): string => rules.select(value),
        );
  return Result.mapError(Result.all([exactKey(spec, value), keyword]), unsupported(spec.name)).pipe(
    Result.map(([exact, rule]) => {
      const numeric = Arr.filter(keys, (key) => numberLiteral.test(key));
      const named = Arr.filter(keys, (key) => Arr.contains(keywords, key));
      return {
        matches: [
          ...Arr.filter(numeric, (key) => key === exact),
          ...Arr.filter(named, (key) => key === rule),
        ],
        errors: Arr.filterMap(keys, (key) =>
          numberLiteral.test(key) || Arr.contains(keywords, key)
            ? Result.failVoid
            : Result.succeed(new BadVariantKey({ function: spec.name, key })),
        ),
      };
    }),
  );
};

const numberValue = (spec: NumberValue): MessageValue => ({
  type: spec.type,
  locale: spec.context.locale,
  dir: localeDirection(spec.context.locale),
  value: spec.value,
  options: spec.options,
  format: Option.some(() =>
    Result.mapError(
      spec.context.intl.numberFormat(spec.context.locale, spec.format),
      unsupported(spec.name),
    ).pipe(
      Result.map((format) => {
        const parts = Arr.filter(
          format.formatToParts(spec.formatted ?? spec.value),
          (part) => !spec.hide(part),
        );
        return {
          type: "number",
          value: Arr.join(
            Arr.map(parts, (part) => part.value),
            "",
          ).trim(),
          parts,
        };
      }),
    ),
  ),
  select: Option.map(
    spec.select,
    (mode) => (keys: ReadonlyArray<string>) => selectKeys(spec, mode, keys),
  ),
});

const showAll = (): boolean => false;

const selectOf = (
  options: { readonly select?: Select },
  rejected: ReadonlyArray<string>,
): Option.Option<Select> =>
  Arr.contains(rejected, "select") ? Option.none() : Option.some(options.select ?? "plural");

/** `:number`: selects and formats a number. */
export const number = MessageFunction.make({
  name: "number",
  operand: Numeric,
  options: { select: Select, ...numberOptions },
  literal: ["select"],
  resolve: ({ context, operand, options, rejected }) =>
    Result.succeed(
      numberValue({
        name: "number",
        type: "number",
        context,
        value: operand,
        options,
        format: intlOptions(Struct.omit(options, ["select"])),
        select: selectOf(options, rejected),
        hide: showAll,
      }),
    ),
});

const integerOptions = Struct.pick(numberOptions, [
  "signDisplay",
  "useGrouping",
  "minimumIntegerDigits",
  "maximumSignificantDigits",
]);

/** `:integer`: selects and formats a number's integer part. */
export const integer = MessageFunction.make({
  name: "integer",
  operand: Numeric,
  options: { select: Select, ...integerOptions },
  literal: ["select"],
  resolve: ({ context, operand, options, rejected }) =>
    Result.succeed(
      numberValue({
        name: "integer",
        type: "integer",
        context,
        value: Math.trunc(operand),
        options,
        format: { ...intlOptions(Struct.omit(options, ["select"])), maximumFractionDigits: 0 },
        select: selectOf(options, rejected),
        hide: showAll,
      }),
    ),
});

/** `:offset`: a number plus or minus a small integer, formatted as its operand was. */
export const offset = MessageFunction.make({
  name: "offset",
  operand: Numeric,
  options: { add: DigitSize, subtract: DigitSize },
  resolve: ({ context, operand, argument, options }) => {
    const deltas = Arr.getSomes([
      Option.fromUndefinedOr(options.add),
      Option.map(Option.fromUndefinedOr(options.subtract), (amount: DigitSize) => -amount),
    ]);
    const [delta] = deltas;
    if (delta === undefined || deltas.length > 1) {
      return Result.fail(new BadOption({ function: "offset", option: "add" }));
    }
    const inherited = Option.getOrUndefined(argument)?.options ?? {};
    const integral = Option.getOrUndefined(argument)?.type === "integer";
    const format = intlOptions(numberOptionsOf(argument));
    return Result.succeed(
      numberValue({
        name: "offset",
        type: integral ? "integer" : "number",
        context,
        value: operand + delta,
        options: inherited,
        format: integral ? { ...format, maximumFractionDigits: 0 } : format,
        select: R.has(inherited, "select") ? Option.none() : Option.some<Select>("plural"),
        hide: showAll,
      }),
    );
  },
});

const percentOptions = Struct.omit(numberOptions, ["minimumIntegerDigits", "roundingIncrement"]);

/** `:percent`: a number times 100, selected by plural rules and formatted as a percentage. */
export const percent = MessageFunction.make({
  name: "percent",
  operand: Numeric,
  options: percentOptions,
  resolve: ({ context, operand, options }) =>
    Result.succeed(
      numberValue({
        name: "percent",
        type: "percent",
        context,
        value: operand,
        selected: Number((operand * 100).toPrecision(15)),
        options,
        format: { ...intlOptions(options), style: "percent" },
        select: Option.some("plural"),
        hide: showAll,
      }),
    ),
});

const CurrencyCode = Schema.String.check(
  Schema.isPattern(/^[A-Za-z]{3}$/, { identifier: "CurrencyCode" }),
);

const currencyDisplay = Schema.Literals(["narrowSymbol", "symbol", "name", "code", "never"]);

/** `:currency`'s operand: a number, or an amount with its currency. */
const CurrencyOperand = Schema.Union([
  Numeric,
  Schema.Struct({ value: Numeric, currency: CurrencyCode }),
]);

const isSeparator = (part: FormattedPart): boolean =>
  part.type === "literal" && /^[\s  ]*$/.test(part.value);

/** `:currency`: formats an amount of money. */
export const currency = MessageFunction.make({
  name: "currency",
  operand: CurrencyOperand,
  options: {
    currency: CurrencyCode,
    currencySign: Schema.Literals(["accounting", "standard"]),
    currencyDisplay,
    ...Struct.pick(numberOptions, [
      "useGrouping",
      "minimumIntegerDigits",
      "minimumSignificantDigits",
      "maximumSignificantDigits",
      "trailingZeroDisplay",
      "roundingPriority",
      "roundingIncrement",
      "roundingMode",
    ]),
    fractionDigits: Schema.Union([Schema.Literal("auto"), DigitSize]),
  },
  resolve: ({ context, operand, options }) => {
    if (P.isNumber(operand) && options.currency === undefined) {
      return Result.fail(new BadOperand({ function: "currency" }));
    }
    if (!P.isNumber(operand) && options.currency !== undefined) {
      return Result.fail(new BadOption({ function: "currency", option: "currency" }));
    }
    const value = P.isNumber(operand) ? operand : operand.value;
    const code = (P.isNumber(operand) ? (options.currency ?? "") : operand.currency).toUpperCase();
    const { currencyDisplay: display, fractionDigits, ...rest } = options;
    const hidden = display === "never";
    return Result.succeed(
      numberValue({
        name: "currency",
        type: "currency",
        context,
        value,
        options: { ...options, currency: code },
        format: {
          ...intlOptions(Struct.omit(rest, ["currency"])),
          style: "currency",
          currency: code,
          currencyDisplay: hidden ? undefined : display,
          minimumFractionDigits: P.isNumber(fractionDigits) ? fractionDigits : undefined,
          maximumFractionDigits: P.isNumber(fractionDigits) ? fractionDigits : undefined,
        },
        select: Option.none(),
        hide: hidden ? (part) => part.type === "currency" || isSeparator(part) : showAll,
      }),
    );
  },
});

const UnitIdentifier = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { identifier: "UnitIdentifier" }),
);

/** `:unit` (draft): formats a measurement. */
export const unit = MessageFunction.make({
  name: "unit",
  status: "draft",
  operand: Schema.Union([Numeric, Schema.Struct({ value: Numeric, unit: UnitIdentifier })]),
  options: {
    unit: UnitIdentifier,
    usage: Schema.String,
    unitDisplay: Schema.Literals(["short", "narrow", "long"]),
    ...Struct.omit(numberOptions, ["trailingZeroDisplay"]),
  },
  resolve: ({ context, operand, options }) => {
    const value = P.isNumber(operand) ? operand : operand.value;
    const measure = P.isNumber(operand) ? options.unit : operand.unit;
    if (measure === undefined) return Result.fail(new BadOperand({ function: "unit" }));
    // Converting to a locale's preferred unit isn't supported.
    if (options.usage !== undefined) {
      return Result.fail(new UnsupportedOperation({ function: "unit", operation: "usage" }));
    }
    const { unit: _unit, usage: _usage, ...rest } = options;
    return Result.succeed(
      numberValue({
        name: "unit",
        type: "unit",
        context,
        value,
        options: { ...options, unit: measure },
        format: { ...intlOptions(rest), style: "unit", unit: measure },
        select: Option.none(),
        hide: showAll,
      }),
    );
  },
});
