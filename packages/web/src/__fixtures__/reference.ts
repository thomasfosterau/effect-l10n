// The reference formatter, and a comparison of a compiled message with it
// on the same parameters, as a string and as parts.
import type * as DataModel from "@thomasfosterau/effect-l10n/messageformat/DataModel";
import {
  formatToParts,
  formatToString,
  Formatter,
  type Part,
} from "@thomasfosterau/effect-l10n/messageformat/Formatter";
import {
  DraftFunctions,
  FunctionRegistry,
} from "@thomasfosterau/effect-l10n/messageformat/FunctionRegistry";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import type { Compiled } from "./harness";

/** The reference formatter, with the draft functions the web target implements. */
export const reference = Formatter.layer.pipe(
  Layer.provide(FunctionRegistry.layer),
  Layer.provide(Layer.succeed(DraftFunctions, true)),
);

/** A reference part as the emitted code writes it: `Option` fields set or left out. */
const plain = (part: Part): R.ReadonlyRecord<string, unknown> => {
  const fields: R.ReadonlyRecord<string, unknown> = { ...part };
  return R.getSomes(
    R.map(fields, (value) => (Option.isOption(value) ? value : Option.some(value))),
  );
};

const canonical = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** A difference between the compiled message and the reference. */
export interface Mismatch {
  readonly expected: string;
  readonly actual: string;
  readonly sameParts: boolean;
}

/** How the compiled message differs from the reference, if it does. */
export const compare = Effect.fn("compare")(function* (
  message: DataModel.Message,
  compiled: Compiled,
  locale: string,
  params: R.ReadonlyRecord<string, unknown>,
  bidiIsolation: "default" | "none" = "default",
) {
  const options = { locale, bidiIsolation, params };
  const expected = (yield* formatToString(message, options)).value;
  const expectedParts = Arr.map((yield* formatToParts(message, options)).value, plain);
  const actual = compiled(params, { locale, bidiIsolation });
  const sameParts =
    canonical(expectedParts) === canonical(compiled.parts(params, { locale, bidiIsolation }));
  return expected === actual && sameParts
    ? Option.none<Mismatch>()
    : Option.some<Mismatch>({ expected, actual, sameParts });
});
