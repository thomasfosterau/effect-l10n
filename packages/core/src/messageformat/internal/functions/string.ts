import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as MessageFunction from "../../MessageFunction";

/**
 * `:string`: selects by NFC equality and formats the operand as is. An
 * unresolved operand reads as the empty string, so the variants still select.
 */
export const string = MessageFunction.make({
  name: "string",
  operand: Schema.Union([
    Schema.String,
    Schema.Finite,
    Schema.Boolean,
    Schema.BigInt,
    Schema.Undefined,
  ]),
  options: {},
  resolve: ({ context, operand }) => {
    const value = operand === undefined ? "" : String(operand);
    const key = value.normalize("NFC");
    return Result.succeed({
      type: "string",
      locale: context.locale,
      dir: "auto",
      value,
      options: {},
      format: Option.some(() => Result.succeed({ type: "string", value })),
      select: Option.some((keys: ReadonlyArray<string>) =>
        Result.succeed({ matches: Arr.filter(keys, (candidate) => candidate === key), errors: [] }),
      ),
    });
  },
});
