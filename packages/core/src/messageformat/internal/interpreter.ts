// The formatter's interpreter: resolves a message's declarations on demand,
// selects a variant and formats its pattern, collecting every error. A hot
// path, so plain code over Results rather than Effects.
import * as Arr from "effect/Array";
import * as MutableHashMap from "effect/MutableHashMap";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import type * as DataModel from "../DataModel";
import {
  BadOption,
  BadSelector,
  type Reason,
  UnknownFunction,
  UnresolvedVariable,
  UnsupportedOperation,
} from "../MessageFormatError";
import type { FunctionContext, OptionValue } from "../MessageFunction";
import type { MessageFunction } from "../MessageFunction";
import type { Direction, MessageValue, ResolvedOptions } from "../MessageValue";

/** A resolved value with its `u:` options, or a fallback's source. */
export type Resolved = Result.Result<Annotated, string>;

export interface Annotated {
  readonly value: MessageValue;
  readonly dir: Direction;
  /** Whether `u:dir` asks for isolation. */
  readonly isolate: boolean;
  readonly id: Option.Option<string>;
}

export interface Environment {
  readonly context: FunctionContext;
  readonly lookup: (name: string) => Option.Option<MessageFunction>;
  readonly params: ResolvedOptions;
  readonly errors: Array<Reason>;
}

interface State extends Environment {
  readonly declarations: ReadonlyArray<DataModel.Declaration>;
  readonly memo: MutableHashMap.MutableHashMap<string, Resolved>;
}

const plain = (value: MessageValue): Annotated => ({
  value,
  dir: value.dir,
  isolate: false,
  id: Option.none(),
});

/** A parameter's or literal's own value. */
type Raw = ResolvedOptions[string];

const textValue = (context: FunctionContext, text: string, raw: Raw): MessageValue => ({
  type: "string",
  locale: context.locale,
  dir: "auto",
  value: raw,
  options: {},
  format: Option.some(() => Result.succeed({ type: "string", value: text })),
  select: Option.none(),
});

/** A parameter's value: numbers format as `:number`, primitives as strings. */
const inputValue = (state: State, raw: Raw): MessageValue => {
  if (P.isNumber(raw)) {
    const number = Option.flatMap(
      state.lookup("number"),
      (fn) =>
        fn.call({
          context: state.context,
          operand: Option.some(textValue(state.context, String(raw), raw)),
          options: {},
        }).value,
    );
    if (Option.isSome(number)) return number.value;
  }
  return P.isString(raw) || P.isNumber(raw) || P.isBoolean(raw) || P.isBigInt(raw)
    ? textValue(state.context, String(raw), raw)
    : { ...textValue(state.context, "", raw), format: Option.none() };
};

const report = (state: Environment, error: Reason): void => {
  state.errors.push(error);
};

const fromParams = (state: State, name: string): Resolved => {
  if (R.has(state.params, name))
    return Result.succeed(plain(inputValue(state, state.params[name])));
  report(state, new UnresolvedVariable({ variable: name }));
  return Result.fail(`$${name}`);
};

// Variable names compare after NFC normalization.
export const resolveVariable = (state: State, variable: string): Resolved => {
  const name = variable.normalize("NFC");
  const cached = MutableHashMap.get(state.memo, name);
  if (Option.isSome(cached)) return cached.value;
  const declaration = Arr.findFirst(state.declarations, (d) => d.name.normalize("NFC") === name);
  const resolved = Option.match(declaration, {
    onNone: () => fromParams(state, name),
    onSome: (d) =>
      d.type === "input"
        ? resolveExpression(state, d.value, (other) =>
            other.normalize("NFC") === name
              ? fromParams(state, name)
              : resolveVariable(state, other),
          )
        : resolveExpression(state, d.value, (other) => resolveVariable(state, other)),
  });
  // A variable whose value fell back falls back to its own name.
  const bound = Result.mapError(resolved, () => `$${name}`);
  MutableHashMap.set(state.memo, name, bound);
  return bound;
};

const escapeLiteral = (value: string): string => `|${value.replaceAll(/[\\|]/g, "\\$&")}|`;

export const fallbackSource = (expression: DataModel.Expression): string =>
  "arg" in expression
    ? expression.arg.type === "literal"
      ? escapeLiteral(expression.arg.value)
      : `$${expression.arg.name}`
    : `:${expression.function.name}`;

const isUOption = (name: string): boolean => name.startsWith("u:");

/** An expression's or markup's options, without `u:` options or fallbacks. */
const resolveOptions = (
  options: DataModel.Options,
  variable: (name: string) => Resolved,
): Record<string, OptionValue> =>
  R.filterMap(
    R.filter(options, (_, name) => !isUOption(name)),
    (operand): Result.Result<OptionValue, string> =>
      operand.type === "literal"
        ? Result.succeed({ value: operand.value, literal: true })
        : Result.map(variable(operand.name), ({ value }) => ({
            value: value.value,
            literal: false,
          })),
  );

/** A `u:` option's string value, if it resolves. */
const uOption = (
  options: DataModel.Options,
  name: string,
  variable: (name: string) => Resolved,
): Option.Option<unknown> =>
  Option.flatMap(R.get(options, name), (operand) =>
    operand.type === "literal"
      ? Option.some(operand.value)
      : Result.getSuccess(Result.map(variable(operand.name), ({ value }) => value.value)),
  );

const directions = ["ltr", "rtl", "auto", "inherit"];

const annotate = (
  state: State,
  value: MessageValue,
  options: DataModel.Options,
  variable: (name: string) => Resolved,
  owner: string,
): Annotated => {
  const dir = Option.flatMap(uOption(options, "u:dir", variable), (raw) => {
    if (P.isString(raw) && Arr.contains(directions, raw)) return Option.some(raw);
    report(state, new BadOption({ function: owner, option: "u:dir" }));
    return Option.none();
  });
  const set = Option.filter(dir, (d) => d !== "inherit");
  return {
    value,
    dir: Option.match(set, {
      onNone: () => value.dir,
      onSome: (d): Direction => (d === "ltr" || d === "rtl" ? d : "auto"),
    }),
    isolate: Option.isSome(set),
    id: Option.filter(uOption(options, "u:id", variable), P.isString),
  };
};

const missing = (state: State): MessageValue => ({
  ...textValue(state.context, "", undefined),
  format: Option.none(),
});

/**
 * Resolves an expression; `variable` resolves its variables, which for an
 * `.input` declaration's own operand reads the parameter.
 */
export const resolveExpression = (
  state: State,
  expression: DataModel.Expression,
  variable: (name: string) => Resolved,
): Resolved => {
  const operand: Option.Option<Resolved> =
    "arg" in expression
      ? Option.some(
          expression.arg.type === "literal"
            ? Result.succeed(
                plain(textValue(state.context, expression.arg.value, expression.arg.value)),
              )
            : variable(expression.arg.name),
        )
      : Option.none();
  const fn = expression.function;
  if (fn === undefined) {
    return Option.getOrElse(operand, () => Result.fail(fallbackSource(expression)));
  }
  const handler = state.lookup(fn.name);
  if (Option.isNone(handler)) {
    report(state, new UnknownFunction({ function: fn.name }));
    return Result.fail(fallbackSource(expression));
  }
  const resolution = handler.value.call({
    context: state.context,
    // A fallback operand still reaches the handler, as a missing value.
    operand: Option.map(operand, (resolved) =>
      Result.match(resolved, { onFailure: () => missing(state), onSuccess: ({ value }) => value }),
    ),
    options: resolveOptions(fn.options, variable),
  });
  Arr.forEach(resolution.errors, (error) => report(state, error));
  return Option.match(resolution.value, {
    onNone: () => Result.fail(fallbackSource(expression)),
    onSome: (value) => Result.succeed(annotate(state, value, fn.options, variable, fn.name)),
  });
};

export const initialState = (
  environment: Environment,
  declarations: ReadonlyArray<DataModel.Declaration>,
): State => ({
  ...environment,
  params: R.mapKeys(environment.params, (name) => name.normalize("NFC")),
  declarations,
  memo: MutableHashMap.empty(),
});

export type { State };

/** The keys at a selector's position that each variant names, without `*`. */
const keysAt = (message: DataModel.SelectMessage, index: number): Array<string> =>
  Arr.dedupe(
    Arr.filterMap(message.variants, (variant) => {
      const key = variant.keys[index];
      return key?.type === "literal" ? Result.succeed(key.value.normalize("NFC")) : Result.failVoid;
    }),
  );

/** Each selector's matching keys, best first; empty for a bad selector. */
const rankings = (state: State, message: DataModel.SelectMessage): Array<ReadonlyArray<string>> =>
  Arr.map(message.selectors, (selector, index) => {
    const bad = (): ReadonlyArray<string> => {
      report(state, new BadSelector({ variable: selector.name }));
      return [];
    };
    const resolved = resolveVariable(state, selector.name);
    const select = Result.isSuccess(resolved) ? resolved.success.value.select : Option.none();
    return Option.match(select, {
      onNone: bad,
      onSome: (fn) =>
        Result.match(fn(keysAt(message, index)), {
          onFailure: bad,
          onSuccess: ({ matches, errors }) => {
            Arr.forEach(errors, (error) => report(state, error));
            return matches;
          },
        }),
    });
  });

/** The rank of a variant's key at one selector: 0 for best, -1 for no match. */
const rank = (ranking: ReadonlyArray<string>, key: DataModel.Key): number =>
  key.type === "*" ? ranking.length : ranking.indexOf(key.value.normalize("NFC"));

export const selectPattern = (
  state: State,
  message: DataModel.SelectMessage,
): DataModel.Pattern => {
  const ranks = rankings(state, message);
  const scored = Arr.filterMap(message.variants, (variant) => {
    const score = Arr.map(variant.keys, (key, i) => rank(ranks[i] ?? [], key));
    return Arr.some(score, (s) => s < 0) ? Result.failVoid : Result.succeed({ variant, score });
  });
  // Lexicographic on each selector's rank: earlier selectors decide first.
  const best = Arr.reduce(scored, Option.none<(typeof scored)[number]>(), (current, next) =>
    Option.match(current, {
      onNone: () => Option.some(next),
      onSome: (c) => {
        const i = Arr.findFirstIndex(next.score, (s, j) => s !== c.score[j]);
        return Option.isSome(i) && (next.score[i.value] ?? 0) < (c.score[i.value] ?? 0)
          ? Option.some(next)
          : current;
      },
    }),
  );
  return Option.match(best, { onNone: () => [], onSome: ({ variant }) => variant.value });
};

/** A formatted placeholder, or the fallback its formatting fell back to. */
export const formatResolved = (
  state: State,
  resolved: Resolved,
  source: string,
): Result.Result<{ readonly annotated: Annotated; readonly formatted: FormattedLike }, string> =>
  Result.flatMap(resolved, (annotated) =>
    Option.match(annotated.value.format, {
      onNone: () => {
        report(
          state,
          new UnsupportedOperation({ function: annotated.value.type, operation: "formatting" }),
        );
        return Result.fail(source);
      },
      onSome: (format) =>
        Result.match(format(), {
          onFailure: (error) => {
            report(state, error);
            return Result.fail(source);
          },
          onSuccess: (formatted) => Result.succeed({ annotated, formatted }),
        }),
    }),
  );

interface FormattedLike {
  readonly type: string;
  readonly value: string;
  readonly parts?: ReadonlyArray<{ readonly type: string; readonly value: string }>;
}

export interface MarkupOptions {
  readonly options: ResolvedOptions;
  readonly id: Option.Option<string>;
}

export const markupOptions = (state: State, markup: DataModel.Markup): MarkupOptions => {
  const variable = (name: string) => resolveVariable(state, name);
  if (R.has(markup.options, "u:dir")) {
    report(state, new BadOption({ function: markup.name, option: "u:dir" }));
  }
  return {
    options: R.map(resolveOptions(markup.options, variable), ({ value }) => value),
    id: Option.filter(uOption(markup.options, "u:id", variable), P.isString),
  };
};
