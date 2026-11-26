// Declarations for the emitted message modules: exact parameter types from
// the functions each parameter is read through, and JSDoc from the
// message's metadata.
import type * as Ir from "@thomasfosterau/effect-l10n/compiler/Ir";
import type * as Lowering from "@thomasfosterau/effect-l10n/compiler/Lowering";
import * as Plan from "@thomasfosterau/effect-l10n/compiler/Plan";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import * as Str from "effect/String";
import { quote } from "./codegen";

const primitive = "string | number | boolean | bigint";
const numeric = "number";
const dateTime = "Date | number | string";

const typeOfFunction: R.ReadonlyRecord<string, string> = {
  string: primitive,
  number: numeric,
  integer: numeric,
  offset: numeric,
  percent: numeric,
  currency: "number | { readonly value: number; readonly currency: string }",
  unit: "number | { readonly value: number; readonly unit: string }",
  datetime: dateTime,
  date: dateTime,
  time: dateTime,
};

/** A parameter's type: what every function it is read through accepts. */
const paramType = (param: Ir.Param): string =>
  Arr.match(
    Arr.dedupe(
      Arr.map(param.functions, (fn) =>
        Option.getOrElse(R.get(typeOfFunction, fn), () => "unknown"),
      ),
    ),
    {
      onEmpty: () => primitive,
      onNonEmpty: (types) =>
        types.length === 1
          ? Arr.headNonEmpty(types)
          : Arr.join(
              Arr.map(types, (t) => `(${t})`),
              " & ",
            ),
    },
  );

const isIdentifier = (name: string) => /^[A-Za-z_$][\w$]*$/.test(name);

/** The parameters' object type. */
const paramsType = (params: ReadonlyArray<Ir.Param>): string =>
  Arr.isReadonlyArrayEmpty(params)
    ? "Readonly<Record<string, never>> | void"
    : `{ ${Arr.join(
        Arr.map(
          params,
          (p) => `readonly ${isIdentifier(p.name) ? p.name : quote(p.name)}: ${paramType(p)}`,
        ),
        "; ",
      )} }`;

/** The markup names a message's patterns use in any locale, as a union. */
const markupType = (message: Lowering.Message): string =>
  Arr.match(
    Arr.sort(
      Arr.dedupe(
        Arr.flatMap(R.values(message.locales), (l) =>
          Arr.flatMap(Plan.leaves(l.plan), (pattern) =>
            Arr.filterMap(pattern, (part) =>
              !P.isString(part) && part.type === "markup"
                ? Result.succeed(part.name)
                : Result.failVoid,
            ),
          ),
        ),
      ),
      Str.Order,
    ),
    { onEmpty: () => "never", onNonEmpty: (names) => Arr.join(Arr.map(names, quote), " | ") },
  );

const escapeComment = (text: string) => text.replaceAll("*/", "*\\/");

/** A JSDoc block from a message's description and context. */
export const docComment = (message: Lowering.Message): string => {
  const lines = [
    ...Option.toArray(Option.fromUndefinedOr(message.description)),
    ...Option.toArray(Option.map(Option.fromUndefinedOr(message.context), (c) => `Context: ${c}`)),
    `Message \`${message.id}\`.`,
  ];
  return `/**\n${Arr.join(
    Arr.map(
      Arr.flatMap(lines, (l) => Str.split(escapeComment(l), "\n")),
      (l) => ` * ${l}`.trimEnd(),
    ),
    "\n *\n",
  )}\n */\n`;
};

/** The type of a message's export. */
export const messageType = (message: Lowering.Message, params: ReadonlyArray<Ir.Param>): string =>
  `Message<${paramsType(params)}, ${markupType(message)}>`;
