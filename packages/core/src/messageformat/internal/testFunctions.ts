// The conformance suite's test functions, `:test:function`, `:test:select`
// and `:test:format`: custom functions with fixed, locale-free behaviour.
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { BadOption } from "../MessageFormatError";
import * as MessageFunction from "../MessageFunction";
import type { FormattedPart } from "../MessageValue";
import { Numeric } from "./options";

const DecimalPlaces = Schema.Union([
  Schema.Literals([0, 1]),
  Schema.Literals(["0", "1"]).pipe(
    Schema.decodeTo(
      Schema.Literals([0, 1]),
      SchemaTransformation.transform({
        decode: (value) => (value === "1" ? 1 : 0),
        encode: (value) => (value === 1 ? "1" : "0"),
      }),
    ),
  ),
]);

const Fails = Schema.Literals(["never", "select", "format", "always"]);

const parts = (input: Numeric, places: 0 | 1): ReadonlyArray<FormattedPart> => {
  const magnitude = Math.abs(input);
  const whole = Math.floor(magnitude);
  return [
    ...(input < 0 ? [{ type: "minusSign", value: "-" }] : []),
    { type: "integer", value: String(whole) },
    ...(places === 1
      ? [
          { type: "decimal", value: "." },
          { type: "fraction", value: String(Math.floor((magnitude - whole) * 10)) },
        ]
      : []),
  ];
};

const make = (name: string, canFormat: boolean, canSelect: boolean) => {
  const failure = () => new BadOption({ function: name, option: "fails" });
  return MessageFunction.make({
    name,
    operand: Numeric,
    options: { decimalPlaces: DecimalPlaces, fails: Fails },
    resolve: ({ context, operand, options, rejected }) => {
      if (Arr.contains(rejected, "decimalPlaces")) {
        return Result.fail(new BadOption({ function: name, option: "decimalPlaces" }));
      }
      const places = options.decimalPlaces ?? 0;
      const fails = options.fails ?? "never";
      return Result.succeed({
        type: "test",
        locale: context.locale,
        dir: "ltr",
        value: operand,
        options,
        format: canFormat
          ? Option.some(() => {
              if (fails === "format" || fails === "always") return Result.fail(failure());
              const formatted = parts(operand, places);
              return Result.succeed({
                type: "test",
                value: Arr.join(
                  Arr.map(formatted, (part) => part.value),
                  "",
                ),
                parts: formatted,
              });
            })
          : Option.none(),
        select: canSelect
          ? Option.some((keys: ReadonlyArray<string>) => {
              if (fails === "select" || fails === "always") return Result.fail(failure());
              const accepted = operand !== 1 ? [] : places === 1 ? ["1.0", "1"] : ["1"];
              return Result.succeed({
                matches: Arr.filter(accepted, (key) => Arr.contains(keys, key)),
                errors: [],
              });
            })
          : Option.none(),
      });
    },
  });
};

export const testFunctions = [
  make("test:function", true, true),
  make("test:select", false, true),
  make("test:format", true, false),
];
