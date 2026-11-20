/**
 * A message's parameters, read from its source: at the type level from a
 * string literal ({@link ParamsOf}, {@link MarkupOf}), and at runtime from
 * its data model ({@link params}, {@link markup}).
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import type * as DataModel from "./DataModel";
import type { date, datetime, time } from "./internal/functions/datetime";
import type { currency, integer, number, offset, percent, unit } from "./internal/functions/number";
import type { string } from "./internal/functions/string";
import { placeholders } from "./internal/patterns";
import type { MessageFunction } from "./MessageFunction";
import type { ResolvedOptions } from "./MessageValue";

/**
 * The value a function's operand decodes from.
 *
 * @category type-level
 * @since 0.1.0
 */
export type OperandOf<F> = F extends MessageFunction<infer A> ? A : never;

/**
 * The operand types of the default functions, by name. Extend it with a
 * custom function's: `DefaultOperands & { "ns:gender": OperandOf<typeof gender> }`.
 *
 * @category type-level
 * @since 0.1.0
 */
export interface DefaultOperands {
  readonly string: Exclude<OperandOf<typeof string>, undefined>;
  readonly number: OperandOf<typeof number>;
  readonly integer: OperandOf<typeof integer>;
  readonly offset: OperandOf<typeof offset>;
  readonly currency: OperandOf<typeof currency>;
  readonly percent: OperandOf<typeof percent>;
  readonly unit: OperandOf<typeof unit>;
  readonly datetime: OperandOf<typeof datetime>;
  readonly date: OperandOf<typeof date>;
  readonly time: OperandOf<typeof time>;
}

/**
 * What a parameter without a function may be: the formatter formats
 * numbers as `:number` and other primitives as strings.
 *
 * @category type-level
 * @since 0.1.0
 */
export type Unannotated = string | number | boolean | bigint;

type Whitespace = " " | "\t" | "\n" | "\r" | "　";

type TrimStart<S extends string> = S extends `${Whitespace}${infer Rest}` ? TrimStart<Rest> : S;

// Characters that end a name or identifier inside an expression.
type Terminator = Whitespace | "}" | "=" | "@" | "|" | "/" | ":" | "$" | "{";

/** The name at the start of `S`, and what follows it. */
type TakeName<S extends string, Name extends string = ""> = S extends `${infer C}${infer Rest}`
  ? C extends Terminator
    ? [Name, S]
    : TakeName<Rest, `${Name}${C}`>
  : [Name, ""];

/** An identifier: a name, optionally with a `namespace:`. */
type TakeIdentifier<S extends string> =
  TakeName<S> extends [infer Namespace extends string, `:${infer Rest}`]
    ? TakeName<Rest> extends [infer Name extends string, infer Tail extends string]
      ? [`${Namespace}:${Name}`, Tail]
      : never
    : TakeName<S>;

// Escapes can't start a placeholder, so they are dropped first.
type Unescape<S extends string> = S extends `${infer A}\\${infer _}${infer B}`
  ? `${A}${Unescape<B>}`
  : S;

/** The bodies of a message's placeholders and declarations' expressions. */
type Bodies<
  S extends string,
  Found extends Array<string> = [],
> = S extends `${string}{${infer Rest}`
  ? Rest extends `{${infer Inner}`
    ? Bodies<Inner, Found>
    : Rest extends `${infer Body}}${infer Tail}`
      ? Bodies<Tail, [...Found, Body]>
      : Found
  : Found;

type JoinEquals<S extends string> = S extends `${infer A}${Whitespace}=${infer B}`
  ? JoinEquals<`${A}=${B}`>
  : S extends `${infer A}=${Whitespace}${infer B}`
    ? JoinEquals<`${A}=${B}`>
    : S;

/** The variables an expression's options read. */
type OptionVariables<S extends string> = S extends `${string}=$${infer Rest}`
  ? TakeName<Rest> extends [infer Name extends string, infer Tail extends string]
    ? { readonly name: Name; readonly fn: "" } | OptionVariables<Tail>
    : never
  : never;

/** The function an expression calls, from the text after its operand. */
type FunctionOf<S extends string> =
  TrimStart<S> extends `:${infer Rest}` ? TakeIdentifier<Rest>[0] : "";

/** Each variable a placeholder reads, with the function it reads it through. */
type Uses<Body extends string> = Body extends string
  ? | (TrimStart<Body> extends `$${infer Rest}`
        ? TakeName<Rest> extends [infer Name extends string, infer Tail extends string]
          ? { readonly name: Name; readonly fn: FunctionOf<Tail> }
          : never
        : never)
    | OptionVariables<JoinEquals<Body>>
  : never;

/** The variables `.local` declares, which aren't parameters. */
type Locals<S extends string> = S extends `${string}.local${infer Rest}`
  ? TrimStart<Rest> extends `$${infer Named}`
    ? TakeName<Named>[0] | Locals<Named>
    : Locals<Rest>
  : never;

type AllUses<S extends string> = Uses<Bodies<Unescape<S>>[number]>;

type TypeOf<Fn extends string, Operands> = Fn extends keyof Operands ? Operands[Fn] : unknown;

type UnionToIntersection<U> = (U extends unknown ? (u: U) => void : never) extends (
  i: infer I,
) => void
  ? I
  : never;

/**
 * A variable's type: what its functions read it as, intersected, or
 * `Unannotated` when no function reads it. A bare `{$x}` beside `{$x :number}`
 * reads the same value, so it adds nothing.
 */
type VariableType<Fns extends string, Operands> = [Exclude<Fns, "">] extends [never]
  ? Unannotated
  : UnionToIntersection<
        Exclude<Fns, ""> extends infer Fn extends string
          ? Fn extends string
            ? { readonly type: TypeOf<Fn, Operands> }
            : never
          : never
      > extends { readonly type: infer T }
    ? T
    : never;

type FunctionsOf<U, Name extends string> = U extends {
  readonly name: Name;
  readonly fn: infer Fn extends string;
}
  ? Fn
  : never;

type Simplify<A> = A extends infer O ? { [K in keyof O]: O[K] } : never;

/** A message without parameters takes none. */
type OrEmpty<A> = [keyof A] extends [never] ? Record<string, never> : A;

/**
 * The parameters a message reads, inferred from its source: each variable
 * that isn't a `.local`, typed by the functions that read it (intersected
 * when several do); `Record<string, never>` when there are none. A `string`
 * that isn't a literal gives `ResolvedOptions`.
 *
 * @category type-level
 * @since 0.1.0
 */
export type ParamsOf<S extends string, Operands = DefaultOperands> = string extends S
  ? ResolvedOptions
  : OrEmpty<
      Simplify<{
        readonly [Name in Exclude<AllUses<S>["name"], Locals<S>>]: VariableType<
          FunctionsOf<AllUses<S>, Name>,
          Operands
        >;
      }>
    >;

type MarkupNames<Body extends string> = Body extends string
  ? TrimStart<Body> extends `${"#" | "/"}${infer Rest}`
    ? TakeIdentifier<Rest>[0]
    : never
  : never;

/**
 * The names of a message's markup, such as `"b" | "link"`.
 *
 * @category type-level
 * @since 0.1.0
 */
export type MarkupOf<S extends string> = string extends S
  ? string
  : MarkupNames<Bodies<Unescape<S>>[number]>;

/**
 * A parameter the runtime reads, and the functions it reads it through.
 *
 * @category runtime
 * @since 0.1.0
 */
export interface Param {
  readonly name: string;
  readonly functions: ReadonlyArray<string>;
}

type Use = readonly [name: string, fn: Option.Option<string>];

const usesOf = (node: DataModel.Expression | DataModel.Markup): ReadonlyArray<Use> => {
  const options = node.type === "markup" ? node.options : (node.function?.options ?? {});
  const fn =
    node.type === "expression" ? Option.fromUndefinedOr(node.function?.name) : Option.none();
  const operand: ReadonlyArray<Use> =
    node.type === "expression" && "arg" in node && node.arg.type === "variable"
      ? [[node.arg.name, fn]]
      : [];
  const fromOptions = Arr.filterMap(R.values(options), (value) =>
    value.type === "variable" ? Result.succeed<Use>([value.name, Option.none()]) : Result.failVoid,
  );
  return [...operand, ...fromOptions];
};

/**
 * The parameters a message reads, in first-use order, with the functions
 * each is read through: the runtime counterpart of {@link ParamsOf}.
 *
 * @category runtime
 * @since 0.1.0
 */
export const params = (message: DataModel.Message): ReadonlyArray<Param> => {
  const locals = Arr.filterMap(message.declarations, (d) =>
    d.type === "local" ? Result.succeed(d.name) : Result.failVoid,
  );
  const uses = Arr.flatMap(
    [...Arr.map(message.declarations, (d) => d.value), ...placeholders(message)],
    usesOf,
  );
  const names = Arr.dedupe(
    Arr.filter(
      Arr.map(uses, ([name]) => name),
      (name) => !Arr.contains(locals, name),
    ),
  );
  return Arr.map(names, (name) => ({
    name,
    functions: Arr.dedupe(
      Arr.getSomes(
        Arr.map(
          Arr.filter(uses, ([used]) => used === name),
          ([, fn]) => fn,
        ),
      ),
    ),
  }));
};

/**
 * The names of a message's markup, in first-use order: the runtime
 * counterpart of {@link MarkupOf}.
 *
 * @category runtime
 * @since 0.1.0
 */
export const markup = (message: DataModel.Message): ReadonlyArray<string> =>
  Arr.dedupe(
    Arr.filterMap(placeholders(message), (part) =>
      part.type === "markup" ? Result.succeed(part.name) : Result.failVoid,
    ),
  );
