import * as Arr from "effect/Array";
import * as P from "effect/Predicate";
import type * as DataModel from "../DataModel";

/** A message's patterns: its own, or each variant's. */
const patternsOf = (message: DataModel.Message): ReadonlyArray<DataModel.Pattern> =>
  message.type === "message" ? [message.pattern] : Arr.map(message.variants, (v) => v.value);

/** Every expression and markup in a message's patterns, in order. */
export const placeholders = (
  message: DataModel.Message,
): ReadonlyArray<DataModel.Expression | DataModel.Markup> =>
  Arr.flatMap(patternsOf(message), (pattern) =>
    Arr.filter(
      pattern,
      (part): part is DataModel.Expression | DataModel.Markup => !P.isString(part),
    ),
  );
