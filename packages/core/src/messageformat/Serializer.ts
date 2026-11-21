/**
 * The MessageFormat 2 serializer: the {@link DataModel} back to canonical
 * syntax, with the least quoting and escaping that parses back to the same
 * model.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Match from "effect/Match";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Str from "effect/String";
import type * as DataModel from "./DataModel";
import { isNameChar } from "./internal/characters";

// Patterns escape only `\`, `{` and `}`; quoted literals only `\` and `|`.
const escapeText = (text: string): string => text.replaceAll(/[\\{}]/g, "\\$&");

const isUnquotable = (value: string): boolean =>
  Str.isNonEmpty(value) &&
  Arr.every(Array.from(value), (char) => isNameChar(char.codePointAt(0) ?? -1));

const literal = (value: DataModel.Literal): string =>
  isUnquotable(value.value) ? value.value : `|${value.value.replaceAll(/[\\|]/g, "\\$&")}|`;

const variable = (value: DataModel.VariableRef): string => `$${value.name}`;

const operand = Match.type<DataModel.Operand>().pipe(
  Match.discriminatorsExhaustive("type")({ literal, variable }),
);

const options = (values: DataModel.Options): string =>
  Arr.join(
    Arr.map(R.toEntries(values), ([name, value]) => ` ${name}=${operand(value)}`),
    "",
  );

const attributes = (values: DataModel.Attributes): string =>
  Arr.join(
    Arr.map(R.toEntries(values), ([name, value]) =>
      value === true ? ` @${name}` : ` @${name}=${literal(value)}`,
    ),
    "",
  );

const functionRef = (value: DataModel.FunctionRef): string =>
  `:${value.name}${options(value.options)}`;

const expression = (value: DataModel.Expression): string => {
  const parts = Arr.filter(
    ["arg" in value ? operand(value.arg) : "", value.function ? functionRef(value.function) : ""],
    Str.isNonEmpty,
  );
  return `{${Arr.join(parts, " ")}${attributes(value.attributes)}}`;
};

const markup = (value: DataModel.Markup): string => {
  const body = `${value.name}${options(value.options)}${attributes(value.attributes)}`;
  return Match.value(value.kind).pipe(
    Match.when("open", () => `{#${body}}`),
    Match.when("standalone", () => `{#${body} /}`),
    Match.when("close", () => `{/${body}}`),
    Match.exhaustive,
  );
};

const placeholder = Match.type<DataModel.Expression | DataModel.Markup>().pipe(
  Match.discriminatorsExhaustive("type")({ expression, markup }),
);

const pattern = (parts: DataModel.Pattern): string =>
  Arr.join(
    Arr.map(parts, (part) => (P.isString(part) ? escapeText(part) : placeholder(part))),
    "",
  );

const declaration = Match.type<DataModel.Declaration>().pipe(
  Match.discriminatorsExhaustive("type")({
    input: (value) => `.input ${expression(value.value)}`,
    local: (value) => `.local $${value.name} = ${expression(value.value)}`,
  }),
);

const key = Match.type<DataModel.Key>().pipe(
  Match.discriminatorsExhaustive("type")({ literal, "*": () => "*" }),
);

const variant = (value: DataModel.Variant): string =>
  `${Arr.join(Arr.map(value.keys, key), " ")} {{${pattern(value.value)}}}`;

// A simple message can't start with `.` after optional whitespace (`o`):
// that reads as a complex message.
const startsComplex = (body: string): boolean => /^[\t\n\r 　؜‎‏⁦-⁩]*\./.test(body);

const withDeclarations = (
  declarations: ReadonlyArray<DataModel.Declaration>,
  body: string,
): string => Arr.join([...Arr.map(declarations, declaration), body], "\n");

/**
 * Serializes a message to MF2 syntax. A pattern message without declarations
 * is written as a simple message when that parses back the same; otherwise
 * each declaration, the `.match` and each variant go on their own line.
 *
 * @category serializing
 * @since 0.1.0
 */
export const serialize: (message: DataModel.Message) => string =
  Match.type<DataModel.Message>().pipe(
    Match.discriminatorsExhaustive("type")({
      message: (message) => {
        const body = pattern(message.pattern);
        return Arr.isReadonlyArrayEmpty(message.declarations) && !startsComplex(body)
          ? body
          : withDeclarations(message.declarations, `{{${body}}}`);
      },
      select: (message) =>
        withDeclarations(
          message.declarations,
          Arr.join(
            [
              `.match ${Arr.join(Arr.map(message.selectors, variable), " ")}`,
              ...Arr.map(message.variants, variant),
            ],
            "\n",
          ),
        ),
    }),
  );
