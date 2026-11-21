/**
 * The errors the MessageFormat 2 engine reports: one `MessageFormatError`
 * whose tagged `reason` names the spec's error, so callers can handle one
 * kind with `Effect.catchReason`.
 *
 * @since 0.1.0
 */
import * as Schema from "effect/Schema";
import { Span } from "./DataModel";

/**
 * A Syntax Error: the source is not a well-formed message. `expected` says
 * what the parser was looking for at `span`.
 *
 * @category reasons
 * @since 0.1.0
 */
export class InvalidSyntax extends Schema.TaggedError<
  InvalidSyntax,
  { readonly brand: unique symbol }
>()("InvalidSyntax", {
  span: Span,
  expected: Schema.String,
}) {
  /** The spec's name for this error. */
  readonly code = "syntax-error";
  override get message(): string {
    return `Expected ${this.expected} at ${this.span.start}`;
  }
}

/**
 * A Duplicate Option Name data model error: a function or markup sets the
 * same option twice.
 *
 * @category reasons
 * @since 0.1.0
 */
export class DuplicateOptionName extends Schema.TaggedError<
  DuplicateOptionName,
  { readonly brand: unique symbol }
>()("DuplicateOptionName", { span: Span, option: Schema.String }) {
  /** The spec's name for this error. */
  readonly code = "duplicate-option-name";
  override get message(): string {
    return `Option ${this.option} is set twice`;
  }
}

/**
 * Why a message was rejected.
 *
 * @category reasons
 * @since 0.1.0
 */
export const Reason = Schema.Union([InvalidSyntax, DuplicateOptionName]);

/**
 * @category reasons
 * @since 0.1.0
 */
export type Reason = typeof Reason.Type;

/**
 * A message was rejected; `reason` says why.
 *
 * @category errors
 * @since 0.1.0
 */
export class MessageFormatError extends Schema.TaggedError<
  MessageFormatError,
  { readonly brand: unique symbol }
>()("MessageFormatError", { reason: Reason }) {
  override get message(): string {
    return this.reason.message;
  }
}
