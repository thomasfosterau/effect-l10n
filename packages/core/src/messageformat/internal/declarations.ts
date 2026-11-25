import * as Arr from "effect/Array";
import * as HashSet from "effect/HashSet";
import * as Option from "effect/Option";
import * as R from "effect/Record";
import * as DataModel from "../DataModel";

/** The function a variable resolves to, following `.local $a = {$b}` chains. */
export const functionOf = (
  message: Pick<DataModel.Message, "declarations">,
  name: string,
  visited: HashSet.HashSet<string> = HashSet.empty(),
): Option.Option<DataModel.FunctionRef> =>
  Option.flatMap(
    Arr.findLast(message.declarations, (declaration) => declaration.name === name),
    (declaration) => {
      const value = declaration.value;
      if (value.function !== undefined) return Option.some(value.function);
      return value instanceof DataModel.VariableExpression &&
        value.arg.name !== name &&
        !HashSet.has(visited, value.arg.name)
        ? functionOf(message, value.arg.name, HashSet.add(visited, name))
        : Option.none();
    },
  );

/** How a selector's function compares keys. */
export type SelectionKind = "plural" | "ordinal" | "exact" | "other";

const pluralFunctions: ReadonlyArray<string> = ["number", "integer", "offset"];

/**
 * `plural` and `ordinal` match CLDR plural categories (and exact numbers),
 * `exact` only exact numbers; anything else is `other`.
 */
export const selectionKind = (fn: DataModel.FunctionRef): SelectionKind => {
  if (!Arr.contains(pluralFunctions, fn.name)) return "other";
  return Option.match(R.get(fn.options, "select"), {
    onNone: (): SelectionKind => "plural",
    onSome: (operand): SelectionKind =>
      operand.type === "literal" && operand.value === "ordinal"
        ? "ordinal"
        : operand.type === "literal" && operand.value === "exact"
          ? "exact"
          : "plural",
  });
};
