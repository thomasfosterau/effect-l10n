/**
 * The reference formatter: formats a message for a locale and parameters,
 * to a string or to parts, with the spec's fallbacks and bidi isolation.
 * Errors are collected alongside the output rather than failing it. Target
 * outputs are tested against it.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Result from "effect/Result";
import type * as DataModel from "./DataModel";
import { DraftFunctions, FunctionRegistry, lookup } from "./FunctionRegistry";
import { localeDirection } from "./internal/locale";
import {
  type Annotated,
  type Environment,
  fallbackSource,
  formatResolved,
  initialState,
  markupOptions,
  resolveExpression,
  resolveVariable,
  selectPattern,
  type State,
} from "./internal/interpreter";
import type { Reason } from "./MessageFormatError";
import { newIntlCache } from "./MessageFunction";
import type { Direction, FormattedPart, ResolvedOptions } from "./MessageValue";
import { check } from "./Validation";

/**
 * Literal text from the pattern.
 *
 * @category parts
 * @since 0.1.0
 */
export interface TextPart {
  readonly type: "text";
  readonly value: string;
}

/**
 * A markup placeholder, with its resolved options (without `u:` options).
 *
 * @category parts
 * @since 0.1.0
 */
export interface MarkupPart {
  readonly type: "markup";
  readonly kind: DataModel.Markup["kind"];
  readonly name: string;
  readonly options: ResolvedOptions;
  readonly id: Option.Option<string>;
}

/**
 * A formatted expression. `type` is the formatted value's type, such as
 * `number`; `dir` is set when `u:dir` set it.
 *
 * @category parts
 * @since 0.1.0
 */
export interface ExpressionPart {
  readonly type: string;
  readonly value: string;
  readonly parts: ReadonlyArray<FormattedPart>;
  readonly locale: string;
  readonly dir: Option.Option<"ltr" | "rtl">;
  readonly id: Option.Option<string>;
}

/**
 * An expression that failed, as its fallback `source`, such as `$x`.
 *
 * @category parts
 * @since 0.1.0
 */
export interface FallbackPart {
  readonly type: "fallback";
  readonly source: string;
}

/**
 * An isolating control character that the default bidi strategy inserted.
 *
 * @category parts
 * @since 0.1.0
 */
export interface BidiIsolationPart {
  readonly type: "bidiIsolation";
  readonly value: "⁦" | "⁧" | "⁨" | "⁩";
}

/**
 * @category parts
 * @since 0.1.0
 */
export type Part = TextPart | MarkupPart | ExpressionPart | FallbackPart | BidiIsolationPart;

/**
 * How to format a message.
 *
 * @category models
 * @since 0.1.0
 */
export interface FormatOptions {
  readonly locale: string;
  /** The parameters, by name; numbers format as `:number`. */
  readonly params?: ResolvedOptions;
  /** `default` isolates placeholders with bidi controls; defaults to `default`. */
  readonly bidiIsolation?: "default" | "none";
  /** The message's direction; defaults to the locale's. */
  readonly dir?: Direction;
}

/**
 * A formatting result and every error found producing it.
 *
 * @category models
 * @since 0.1.0
 */
export interface Formatted<A> {
  readonly value: A;
  readonly errors: ReadonlyArray<Reason>;
}

/**
 * The formatter service.
 *
 * @category services
 * @since 0.1.0
 */
export class Formatter extends Context.Service<
  Formatter,
  {
    readonly formatToParts: (
      message: DataModel.Message,
      options: FormatOptions,
    ) => Formatted<ReadonlyArray<Part>>;
    readonly formatToString: (
      message: DataModel.Message,
      options: FormatOptions,
    ) => Formatted<string>;
  }
>()("@thomasfosterau/effect-l10n/messageformat/Formatter") {
  /**
   * A formatter over the current `FunctionRegistry` and `DraftFunctions`.
   * It holds one `Intl` cache for its lifetime.
   */
  static readonly layer: Layer.Layer<Formatter, never, FunctionRegistry> = Layer.effect(
    Formatter,
    Effect.gen(function* () {
      const registry = yield* FunctionRegistry;
      const drafts = yield* DraftFunctions;
      const intl = newIntlCache();
      const formatToParts = (message: DataModel.Message, options: FormatOptions) =>
        partsOf(message, options, {
          context: { locale: options.locale, intl },
          lookup: (name) => lookup(registry, name, drafts),
          params: options.params ?? {},
          errors: [],
        });
      return {
        formatToParts,
        formatToString: (message, options) => {
          const { value, errors } = formatToParts(message, options);
          return { value: Arr.join(Arr.map(value, partToString), ""), errors };
        },
      };
    }),
  );
}

const isolates = { ltr: "⁦", rtl: "⁧", auto: "⁨" } as const;
const pop: BidiIsolationPart = { type: "bidiIsolation", value: "⁩" };

/** The default bidi strategy's opening isolate for a placeholder, if any. */
const isolateFor = (
  message: Direction,
  dir: Direction,
  isolate: boolean,
): Option.Option<BidiIsolationPart> =>
  dir === "ltr" && message === "ltr" && !isolate
    ? Option.none()
    : Option.some({ type: "bidiIsolation", value: isolates[dir] });

const expressionPart = (annotated: Annotated, formatted: ExpressionPartInput): ExpressionPart => ({
  type: formatted.type,
  value: formatted.value,
  parts: formatted.parts ?? [],
  locale: annotated.value.locale,
  dir: annotated.isolate && annotated.dir !== "auto" ? Option.some(annotated.dir) : Option.none(),
  id: annotated.id,
});

interface ExpressionPartInput {
  readonly type: string;
  readonly value: string;
  readonly parts?: ReadonlyArray<FormattedPart>;
}

/** What the bidi strategy needs to know about a placeholder. */
type Placement = Pick<Annotated, "dir" | "isolate">;

const placeholderParts = (
  state: State,
  expression: DataModel.Expression,
  bidi: Option.Option<Direction>,
): ReadonlyArray<Part> => {
  const source = fallbackSource(expression);
  const formatted = formatResolved(
    state,
    resolveExpression(state, expression, (name) => resolveVariable(state, name)),
    source,
  );
  const part: Part = Result.match(formatted, {
    onFailure: (fallback): Part => ({ type: "fallback", source: fallback }),
    onSuccess: ({ annotated, formatted: value }): Part => expressionPart(annotated, value),
  });
  const dir = Result.match(formatted, {
    onFailure: (): Placement => ({ dir: "auto", isolate: false }),
    onSuccess: ({ annotated }): Placement => annotated,
  });
  return Option.match(bidi, {
    onNone: () => [part],
    onSome: (message) =>
      Option.match(isolateFor(message, dir.dir, dir.isolate), {
        onNone: () => [part],
        onSome: (open) => [open, part, pop],
      }),
  });
};

const markupPart = (state: State, markup: DataModel.Markup): MarkupPart => {
  const { options, id } = markupOptions(state, markup);
  return { type: "markup", kind: markup.kind, name: markup.name, options, id };
};

const partsOf = (
  message: DataModel.Message,
  options: FormatOptions,
  environment: Environment,
): Formatted<ReadonlyArray<Part>> => {
  const invalid = Arr.filter(check(message), (diagnostic) => diagnostic.severity === "error");
  if (Arr.isArrayNonEmpty(invalid)) {
    return {
      value: [{ type: "fallback", source: "�" }],
      errors: Arr.map(invalid, (diagnostic) => diagnostic.reason),
    };
  }
  const state = initialState(environment, message.declarations);
  const bidi =
    options.bidiIsolation === "none"
      ? Option.none<Direction>()
      : Option.some(options.dir ?? localeDirection(options.locale));
  const pattern = message.type === "message" ? message.pattern : selectPattern(state, message);
  const value = Arr.flatMap(pattern, (part): ReadonlyArray<Part> => {
    if (P.isString(part)) return [{ type: "text", value: part }];
    return part.type === "markup" ? [markupPart(state, part)] : placeholderParts(state, part, bidi);
  });
  return { value, errors: state.errors };
};

const partToString = (part: Part): string => {
  if ("kind" in part) return "";
  if ("source" in part) return `{${part.source}}`;
  return part.value;
};

/**
 * Formats a message to parts.
 *
 * @category formatting
 * @since 0.1.0
 */
export const formatToParts = (
  message: DataModel.Message,
  options: FormatOptions,
): Effect.Effect<Formatted<ReadonlyArray<Part>>, never, Formatter> =>
  Effect.gen(function* () {
    const formatter = yield* Formatter;
    return formatter.formatToParts(message, options);
  });

/**
 * Formats a message to a string; fallbacks read `{source}`.
 *
 * @category formatting
 * @since 0.1.0
 */
export const formatToString = (
  message: DataModel.Message,
  options: FormatOptions,
): Effect.Effect<Formatted<string>, never, Formatter> =>
  Effect.gen(function* () {
    const formatter = yield* Formatter;
    return formatter.formatToString(message, options);
  });
