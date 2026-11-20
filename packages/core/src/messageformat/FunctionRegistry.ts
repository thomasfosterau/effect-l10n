/**
 * The functions a message can call, by name: the spec's default functions,
 * plus any custom ones added with {@link add}. Draft default functions are
 * found only when {@link DraftFunctions} is on.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as R from "effect/Record";
import { date, datetime, time } from "./internal/functions/datetime";
import { currency, integer, number, offset, percent, unit } from "./internal/functions/number";
import { string } from "./internal/functions/string";
import type { MessageFunction } from "./MessageFunction";

/**
 * The spec's default functions: `:string`, `:number`, `:integer`,
 * `:offset`, `:currency` and `:percent`, and the drafts `:unit`,
 * `:datetime`, `:date` and `:time`.
 *
 * @category functions
 * @since 0.1.0
 */
export const defaults: ReadonlyArray<MessageFunction> = [
  string,
  number,
  integer,
  offset,
  currency,
  percent,
  unit,
  datetime,
  date,
  time,
];

/**
 * Whether messages may call draft functions. Off by default, since a
 * draft's options and output can change in a later release of the spec.
 *
 * @category settings
 * @since 0.1.0
 */
export const DraftFunctions = Context.Reference<boolean>(
  "@thomasfosterau/effect-l10n/messageformat/DraftFunctions",
  { defaultValue: () => false },
);

const byName = (
  functions: ReadonlyArray<MessageFunction>,
): R.ReadonlyRecord<string, MessageFunction> =>
  R.fromEntries(Arr.map(functions, (fn) => [fn.name, fn] as const));

/**
 * The registry: every function a message can call, by name.
 *
 * @category services
 * @since 0.1.0
 */
export class FunctionRegistry extends Context.Service<
  FunctionRegistry,
  { readonly functions: R.ReadonlyRecord<string, MessageFunction> }
>()("@thomasfosterau/effect-l10n/messageformat/FunctionRegistry") {
  /** The default functions. */
  static readonly layer: Layer.Layer<FunctionRegistry> = Layer.succeed(FunctionRegistry, {
    functions: byName(defaults),
  });
}

/**
 * A layer that adds functions to the registry it is given, replacing any of
 * the same name: `add(gender).pipe(Layer.provide(FunctionRegistry.layer))`.
 *
 * @category layers
 * @since 0.1.0
 */
export const add = (
  ...functions: ReadonlyArray<MessageFunction>
): Layer.Layer<FunctionRegistry, never, FunctionRegistry> =>
  Layer.effect(
    FunctionRegistry,
    Effect.gen(function* () {
      const registry = yield* FunctionRegistry;
      return { functions: { ...registry.functions, ...byName(functions) } };
    }),
  );

/**
 * The function a name calls. A draft function is found only if `drafts` is
 * true.
 *
 * @category lookup
 * @since 0.1.0
 */
export const lookup = (
  registry: FunctionRegistry["Service"],
  name: string,
  drafts: boolean,
): Option.Option<MessageFunction> =>
  Option.filter(R.get(registry.functions, name), (fn) => drafts || fn.status === "stable");

/**
 * The function a name calls in the current registry, honouring
 * {@link DraftFunctions}.
 *
 * @category lookup
 * @since 0.1.0
 */
export const get = (
  name: string,
): Effect.Effect<Option.Option<MessageFunction>, never, FunctionRegistry> =>
  Effect.gen(function* () {
    const registry = yield* FunctionRegistry;
    const drafts = yield* DraftFunctions;
    return lookup(registry, name, drafts);
  });
