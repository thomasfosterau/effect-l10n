/**
 * Resolved values: what a function handler returns, and what declarations
 * bind, selectors compare and placeholders format.
 *
 * @since 0.1.0
 */
import type * as Option from "effect/Option";
import type * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { FunctionError } from "./MessageFormatError";

/**
 * A value's base direction; `auto` when it isn't known.
 *
 * @category models
 * @since 0.1.0
 */
export type Direction = "ltr" | "rtl" | "auto";

/**
 * A piece of a formatted value, such as an `Intl.NumberFormat` part.
 *
 * @category models
 * @since 0.1.0
 */
export interface FormattedPart {
  readonly type: string;
  readonly value: string;
}

/**
 * A placeholder's formatted value: its string, and its parts when the
 * function splits it (as `:number` does).
 *
 * @category models
 * @since 0.1.0
 */
export interface FormattedValue {
  /** The resolved value's type, such as `number` or `string`. */
  readonly type: string;
  readonly value: string;
  readonly parts?: ReadonlyArray<FormattedPart>;
}

/**
 * The keys a selector matches, best first, and any keys it couldn't compare
 * against.
 *
 * @category models
 * @since 0.1.0
 */
export interface Selection {
  readonly matches: ReadonlyArray<string>;
  readonly errors: ReadonlyArray<FunctionError>;
}

/**
 * A value's resolved options, by name. Each function decodes the ones it
 * reads with its own option schemas.
 *
 * @category models
 * @since 0.1.0
 */
export const ResolvedOptions = Schema.Record(Schema.String, Schema.Unknown);

/**
 * @category models
 * @since 0.1.0
 */
export type ResolvedOptions = typeof ResolvedOptions.Type;

/**
 * A resolved value. A value that can't `format` can't be a placeholder, and
 * one that can't `select` can't be a selector.
 *
 * @category models
 * @since 0.1.0
 */
export interface MessageValue {
  /** The function that produced the value, such as `number`. */
  readonly type: string;
  readonly locale: string;
  readonly dir: Direction;
  /** The value an operand or option reads. */
  readonly value: unknown;
  /** The options a later function inherits when this value is its operand. */
  readonly options: ResolvedOptions;
  readonly format: Option.Option<() => Result.Result<FormattedValue, FunctionError>>;
  /** The given keys (normalized, without `*`) that match, best first. */
  readonly select: Option.Option<
    (keys: ReadonlyArray<string>) => Result.Result<Selection, FunctionError>
  >;
}
