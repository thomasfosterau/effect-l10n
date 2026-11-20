/**
 * Function handlers: how an MF2 function such as `:number` resolves its
 * operand and options to a {@link MessageValue}. Define one with
 * {@link make}; its operand and options are decoded with `Schema`s, so the
 * handler only sees values it can use.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as MutableHashMap from "effect/MutableHashMap";
import * as Option from "effect/Option";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { BadOperand, BadOption, type FunctionError } from "./MessageFormatError";
import type { MessageValue } from "./MessageValue";

/**
 * `Intl` objects, built once per locale and options. Constructors that
 * reject their arguments fail with the `RangeError`.
 *
 * @category context
 * @since 0.1.0
 */
export interface IntlCache {
  readonly numberFormat: (
    locale: string,
    options: Intl.NumberFormatOptions,
  ) => Result.Result<Intl.NumberFormat, unknown>;
  readonly pluralRules: (
    locale: string,
    options: Intl.PluralRulesOptions,
  ) => Result.Result<Intl.PluralRules, unknown>;
  readonly dateTimeFormat: (
    locale: string,
    options: Intl.DateTimeFormatOptions,
  ) => Result.Result<Intl.DateTimeFormat, unknown>;
}

const memoize = <O extends object, A>(
  build: (locale: string, options: O) => A,
): ((locale: string, options: O) => Result.Result<A, unknown>) => {
  const cache = MutableHashMap.empty<string, A>();
  return (locale, options) => {
    const key = Arr.join(
      [
        locale,
        ...Arr.map(R.toEntries(options), ([name, value]) => `${String(name)}=${String(value)}`),
      ],
      "\u0000",
    );
    return Option.match(MutableHashMap.get(cache, key), {
      onSome: Result.succeed,
      onNone: () =>
        Result.map(
          Result.try(() => build(locale, options)),
          (built) => {
            MutableHashMap.set(cache, key, built);
            return built;
          },
        ),
    });
  };
};

/**
 * A fresh, empty {@link IntlCache}.
 *
 * @category context
 * @since 0.1.0
 */
export const newIntlCache = (): IntlCache => ({
  numberFormat: memoize((locale, options) => new Intl.NumberFormat(locale, options)),
  pluralRules: memoize((locale, options) => new Intl.PluralRules(locale, options)),
  dateTimeFormat: memoize((locale, options) => new Intl.DateTimeFormat(locale, options)),
});

/**
 * What a handler may read from the formatting context.
 *
 * @category context
 * @since 0.1.0
 */
export interface FunctionContext {
  readonly locale: string;
  readonly intl: IntlCache;
}

/**
 * An option's resolved value, and whether a literal set it.
 *
 * @category calling
 * @since 0.1.0
 */
export interface OptionValue {
  readonly value: unknown;
  readonly literal: boolean;
}

/**
 * One call of a function: its resolved operand, if it has one, and options.
 *
 * @category calling
 * @since 0.1.0
 */
export interface Call {
  readonly context: FunctionContext;
  readonly operand: Option.Option<MessageValue>;
  readonly options: Readonly<Record<string, OptionValue>>;
}

/**
 * A call's result: its value, or none if the expression falls back, and
 * the errors it reported either way.
 *
 * @category calling
 * @since 0.1.0
 */
export interface Resolution {
  readonly value: Option.Option<MessageValue>;
  readonly errors: ReadonlyArray<FunctionError>;
}

/**
 * Whether a function is in a stable release of the spec, or still a draft.
 *
 * @category models
 * @since 0.1.0
 */
export type Status = "stable" | "draft";

/**
 * A function, as the registry holds it. `Operand` is the type its operand
 * decodes to, which a message's parameters are inferred from.
 *
 * @category models
 * @since 0.1.0
 */
export interface MessageFunction<out Operand = unknown> {
  /** The identifier, without the `:`, such as `number` or `ns:gender`. */
  readonly name: string;
  readonly status: Status;
  readonly operand: Schema.ConstraintDecoder<Operand>;
  readonly call: (call: Call) => Resolution;
}

/**
 * The codecs of a function's options, by name.
 *
 * @category models
 * @since 0.1.0
 */
export type OptionFields = Readonly<Record<string, Schema.ConstraintDecoder<unknown>>>;

/**
 * The decoded options a handler receives: each one is set only if it
 * decoded.
 *
 * @category models
 * @since 0.1.0
 */
export type OptionsOf<Fields extends OptionFields> = {
  readonly [K in keyof Fields]?: Fields[K]["Type"];
};

/**
 * What a handler receives.
 *
 * @category models
 * @since 0.1.0
 */
export interface Input<Operand, Fields extends OptionFields> {
  readonly context: FunctionContext;
  readonly operand: Operand;
  /** The operand's resolved value, if the expression has an operand. */
  readonly argument: Option.Option<MessageValue>;
  readonly options: OptionsOf<Fields>;
  /** Options that were set but ignored, each already reported as `bad-option`. */
  readonly rejected: ReadonlyArray<keyof Fields & string>;
}

/**
 * A function's definition.
 *
 * @category models
 * @since 0.1.0
 */
export interface Definition<Operand, Fields extends OptionFields> {
  readonly name: string;
  /** Defaults to `stable`. */
  readonly status?: Status;
  /** Decodes the operand's value; an expression without one decodes `undefined`. */
  readonly operand: Schema.ConstraintDecoder<Operand>;
  readonly options: Fields;
  /** Options a variable or an operand's value must not set. */
  readonly literal?: ReadonlyArray<keyof Fields & string>;
  /** Options read from the operand's resolved options. Defaults to all of them. */
  readonly inherit?: ReadonlyArray<keyof Fields & string>;
  readonly resolve: (input: Input<Operand, Fields>) => Result.Result<MessageValue, FunctionError>;
}

interface Candidate {
  readonly name: string;
  readonly option: OptionValue;
}

/**
 * Defines a function. The handler is called only once the operand has
 * decoded; options that don't decode, or that `literal` says a variable set,
 * are reported as `bad-option` and left out.
 *
 * @category constructors
 * @since 0.1.0
 */
export const make = <Operand, const Fields extends OptionFields>(
  definition: Definition<Operand, Fields>,
): MessageFunction<Operand> => {
  const decodeOperand = Schema.decodeUnknownOption(definition.operand);
  const decoders = R.map(definition.options, (codec) => Schema.decodeUnknownOption(codec));
  const literal = definition.literal ?? [];
  const inherit = definition.inherit ?? R.keys(definition.options);
  const badOption = (option: string) => new BadOption({ function: definition.name, option });

  const candidates = (call: Call): Array<Candidate> => {
    const explicit = Arr.filter(R.keys(call.options), (name) => R.has(decoders, name));
    const inherited = Option.match(call.operand, {
      onNone: () => [],
      onSome: (operand) =>
        Arr.filter(
          inherit,
          (name) => R.has(operand.options, name) && !Arr.contains(explicit, name),
        ).map((name) => ({ name, option: { value: operand.options[name], literal: false } })),
    });
    return [
      ...inherited,
      ...Arr.filterMap(explicit, (name) =>
        Result.fromNullishOr(call.options[name], () => undefined).pipe(
          Result.map((option) => ({ name, option })),
        ),
      ),
    ];
  };

  return {
    name: definition.name,
    status: definition.status ?? "stable",
    operand: definition.operand,
    call: (call) =>
      Option.match(decodeOperand(Option.getOrUndefined(call.operand)?.value), {
        onNone: () => ({
          value: Option.none(),
          errors: [new BadOperand({ function: definition.name })],
        }),
        onSome: (operand) => {
          const decoded = Arr.map(candidates(call), ({ name, option }) => ({
            name,
            value:
              Arr.contains(literal, name) && !option.literal
                ? Option.none()
                : Option.flatMap(Option.fromNullishOr(decoders[name]), (decode) =>
                    decode(option.value),
                  ),
          }));
          const rejected = Arr.filterMap(decoded, ({ name, value }) =>
            Option.isNone(value) ? Result.succeed(name) : Result.failVoid,
          );
          const options = R.fromEntries(
            Arr.filterMap(decoded, ({ name, value }) =>
              Option.match(value, {
                onNone: () => Result.failVoid,
                onSome: (v) => Result.succeed([name, v] as const),
              }),
            ),
          );
          const resolved = definition.resolve({
            context: call.context,
            operand,
            argument: call.operand,
            // The decoders only produce each field's own type.
            options: options,
            rejected,
          });
          const reported = Arr.map(rejected, badOption);
          return Result.match(resolved, {
            onSuccess: (value) => ({ value: Option.some(value), errors: reported }),
            // A handler may fail because of an option this call already reported.
            onFailure: (error) => ({
              value: Option.none(),
              errors:
                error instanceof BadOption && Arr.contains(rejected, error.option)
                  ? reported
                  : [...reported, error],
            }),
          });
        },
      }),
  };
};
