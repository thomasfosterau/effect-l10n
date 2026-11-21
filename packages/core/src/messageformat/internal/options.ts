// Operand and option codecs shared by the default functions. Each decodes
// both a literal's string and the value a variable or earlier function holds.
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

/** The spec's `number-literal` production. */
export const numberLiteral = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/;

const fromString = (pattern: RegExp, identifier: string) =>
  Schema.String.check(Schema.isPattern(pattern, { identifier })).pipe(
    Schema.decodeTo(
      Schema.Finite,
      SchemaTransformation.transform({ decode: Number, encode: String }),
    ),
  );

/** A _numeric operand_: a finite number, or a string matching `number-literal`. */
export const Numeric = Schema.Union([Schema.Finite, fromString(numberLiteral, "NumberLiteral")]);

export type Numeric = typeof Numeric.Type;

/** A _digit size option_: a small non-negative integer, or its string. */
export const DigitSize = Schema.Union([
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 99 })),
  fromString(/^(?:0|[1-9]\d?)$/, "DigitSize"),
]);

export type DigitSize = typeof DigitSize.Type;

/** `true` or `false`, as a boolean or its string. */
export const BooleanOption = Schema.Union([
  Schema.Boolean,
  Schema.Literals(["true", "false"]).pipe(
    Schema.decodeTo(
      Schema.Boolean,
      SchemaTransformation.transform({
        decode: (value) => value === "true",
        encode: (value) => (value ? "true" : "false"),
      }),
    ),
  ),
]);

export type BooleanOption = typeof BooleanOption.Type;

const signDisplay = Schema.Literals(["auto", "always", "exceptZero", "negative", "never"]);
const useGrouping = Schema.Literals(["auto", "always", "never", "min2"]);
const trailingZeroDisplay = Schema.Literals(["auto", "stripIfInteger"]);
const roundingPriority = Schema.Literals(["auto", "morePrecision", "lessPrecision"]);
const increments = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000] as const;
const Increment = Schema.Literals(increments);
const roundingIncrement = Schema.Union([
  Increment,
  fromString(/^\d+$/, "RoundingIncrement").pipe(
    Schema.decodeTo(Increment, SchemaTransformation.passthroughSupertype()),
  ),
]);
const roundingMode = Schema.Literals([
  "ceil",
  "floor",
  "expand",
  "trunc",
  "halfCeil",
  "halfFloor",
  "halfExpand",
  "halfTrunc",
  "halfEven",
]);

/** The `Intl.NumberFormat` options every number function shares. */
export const numberOptions = {
  signDisplay,
  useGrouping,
  minimumIntegerDigits: DigitSize,
  minimumFractionDigits: DigitSize,
  maximumFractionDigits: DigitSize,
  minimumSignificantDigits: DigitSize,
  maximumSignificantDigits: DigitSize,
  trailingZeroDisplay,
  roundingPriority,
  roundingIncrement,
  roundingMode,
} as const;

/** `:number` and `:integer`'s `select` option. */
export const Select = Schema.Literals(["plural", "ordinal", "exact"]);

export type Select = typeof Select.Type;
