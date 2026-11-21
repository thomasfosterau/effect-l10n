/**
 * `Message.make`: a source-locale message, its MessageFormat 2 pattern, its
 * parameters as `Schema`s (inferred from the pattern when left out) and the
 * notes translators see. Plain data: making a message parses nothing.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { ParamsOf } from "./messageformat/Params";

const Codec = Schema.declare((u): u is Schema.Top => Schema.isSchema(u), {
  expected: "a Schema",
});

const strings = Schema.Array(Schema.String);

/**
 * A source-locale message.
 *
 * @category models
 * @since 0.1.0
 */
export class Message extends Schema.Class<Message, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/Message",
)({
  /** The MessageFormat 2 source. */
  source: Schema.String,
  /** An explicit ID, kept when the export is renamed or moved. */
  id: Schema.optionalKey(Schema.String),
  /** The parameters' schemas, by name. */
  params: Schema.optionalKey(Schema.Record(Schema.String, Codec)),
  /** What the message is for, for translators. */
  description: Schema.optionalKey(Schema.String),
  /** Where the message appears. */
  context: Schema.optionalKey(Schema.String),
  /** The most characters a translation may have. */
  maxLength: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  /** Paths or URLs of screenshots showing the message. */
  screenshots: strings.pipe(Schema.optionalKey, Schema.withConstructorDefault(Effect.succeed([]))),
  /** Whether translators should keep the message as is, such as a brand name. */
  doNotTranslate: Schema.Boolean.pipe(
    Schema.optionalKey,
    Schema.withConstructorDefault(Effect.succeed(false)),
  ),
  /** Labels for grouping and filtering. */
  tags: strings.pipe(Schema.optionalKey, Schema.withConstructorDefault(Effect.succeed([]))),
}) {}

declare const ParamsType: unique symbol;

/**
 * A message whose parameters' types are known: `P` is what formatting it
 * takes.
 *
 * @category models
 * @since 0.1.0
 */
export interface Typed<P> extends Message {
  readonly [ParamsType]?: P;
}

/**
 * The parameters a message takes.
 *
 * @category type-level
 * @since 0.1.0
 */
export type Params<M> = M extends Typed<infer P> ? P : never;

/**
 * A schema for each parameter `S` reads, whose type fits what the pattern
 * reads it as.
 *
 * @category type-level
 * @since 0.1.0
 */
export type ParamSchemas<S extends string> = {
  readonly [K in keyof ParamsOf<S>]: Schema.Top & { readonly Type: ParamsOf<S>[K] };
};

/**
 * What {@link make} takes besides the source.
 *
 * @category models
 * @since 0.1.0
 */
export interface Options<P> {
  readonly id?: string;
  readonly params?: P;
  readonly description?: string;
  readonly context?: string;
  readonly maxLength?: number;
  readonly screenshots?: ReadonlyArray<string>;
  readonly doNotTranslate?: boolean;
  readonly tags?: ReadonlyArray<string>;
}

type TypesOf<P> = { readonly [K in keyof P]: P[K] extends Schema.Top ? P[K]["Type"] : never };

/**
 * Declares a message. With `params`, each parameter's type is its schema's;
 * without, it is inferred from the pattern. A `maxLength` that isn't a
 * positive integer throws.
 *
 * @category constructors
 * @since 0.1.0
 */
export const make = <const S extends string, const P extends ParamSchemas<S> = never>(
  source: S,
  options: Options<P> = {},
): Typed<[P] extends [never] ? ParamsOf<S> : TypesOf<P>> =>
  new Message({
    source,
    ...options,
    screenshots: options.screenshots ?? [],
    tags: options.tags ?? [],
  });

/**
 * Whether a value is a {@link Message}.
 *
 * @category guards
 * @since 0.1.0
 */
export const isMessage = (u: unknown): u is Message => u instanceof Message;
