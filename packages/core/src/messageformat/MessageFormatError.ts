/**
 * The errors the MessageFormat 2 engine reports: one `MessageFormatError`
 * whose tagged `reason` names the problem, so callers can handle one kind
 * with `Effect.catchReason`. Each reason's `code` is the spec's name for it,
 * or an effect-l10n name for a lint finding.
 *
 * @since 0.1.0
 */
import * as Schema from "effect/Schema";
import { Span } from "./DataModel";

/**
 * `syntax-error`: the source is not a well-formed message. `expected` says
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
 * `duplicate-option-name`: a function or markup sets the same option twice.
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

// Data model errors and lint findings point at a node, which has a span only
// when it was parsed.
const at = Schema.optionalKey(Span);

/**
 * `variant-key-mismatch`: a variant has a different number of keys than the
 * message has selectors.
 *
 * @category reasons
 * @since 0.1.0
 */
export class VariantKeyMismatch extends Schema.TaggedError<
  VariantKeyMismatch,
  { readonly brand: unique symbol }
>()("VariantKeyMismatch", { span: at, keys: Schema.Int, selectors: Schema.Int }) {
  /** The spec's name for this error. */
  readonly code = "variant-key-mismatch";
  override get message(): string {
    return `A variant has ${this.keys} keys for ${this.selectors} selectors`;
  }
}

/**
 * `missing-fallback-variant`: no variant has only `*` keys.
 *
 * @category reasons
 * @since 0.1.0
 */
export class MissingFallbackVariant extends Schema.TaggedError<
  MissingFallbackVariant,
  { readonly brand: unique symbol }
>()("MissingFallbackVariant", { span: at }) {
  /** The spec's name for this error. */
  readonly code = "missing-fallback-variant";
  override get message(): string {
    return "No variant has only `*` keys";
  }
}

/**
 * `missing-selector-annotation`: a selector's variable doesn't lead, through
 * its declarations, to an expression with a function.
 *
 * @category reasons
 * @since 0.1.0
 */
export class MissingSelectorAnnotation extends Schema.TaggedError<
  MissingSelectorAnnotation,
  { readonly brand: unique symbol }
>()("MissingSelectorAnnotation", { span: at, variable: Schema.String }) {
  /** The spec's name for this error. */
  readonly code = "missing-selector-annotation";
  override get message(): string {
    return `Selector $${this.variable} has no function`;
  }
}

/**
 * `duplicate-declaration`: a variable is declared twice, or declared after
 * an earlier declaration used it.
 *
 * @category reasons
 * @since 0.1.0
 */
export class DuplicateDeclaration extends Schema.TaggedError<
  DuplicateDeclaration,
  { readonly brand: unique symbol }
>()("DuplicateDeclaration", { span: at, variable: Schema.String }) {
  /** The spec's name for this error. */
  readonly code = "duplicate-declaration";
  override get message(): string {
    return `$${this.variable} is declared after it was declared or used`;
  }
}

/**
 * `duplicate-variant`: two variants have the same keys.
 *
 * @category reasons
 * @since 0.1.0
 */
export class DuplicateVariant extends Schema.TaggedError<
  DuplicateVariant,
  { readonly brand: unique symbol }
>()("DuplicateVariant", { span: at }) {
  /** The spec's name for this error. */
  readonly code = "duplicate-variant";
  override get message(): string {
    return "Another variant has the same keys";
  }
}

/**
 * `unused-local` (lint): a `.local` variable is never used.
 *
 * @category reasons
 * @since 0.1.0
 */
export class UnusedLocal extends Schema.TaggedError<
  UnusedLocal,
  { readonly brand: unique symbol }
>()("UnusedLocal", { span: at, variable: Schema.String }) {
  /** effect-l10n's name for this finding. */
  readonly code = "unused-local";
  override get message(): string {
    return `.local $${this.variable} is never used`;
  }
}

/**
 * `unreachable-variant` (lint): a plural selector can never produce this
 * key in the locale, because it is neither a number nor one of the locale's
 * plural categories.
 *
 * @category reasons
 * @since 0.1.0
 */
export class UnreachableVariant extends Schema.TaggedError<
  UnreachableVariant,
  { readonly brand: unique symbol }
>()("UnreachableVariant", { span: at, key: Schema.String, locale: Schema.String }) {
  /** effect-l10n's name for this finding. */
  readonly code = "unreachable-variant";
  override get message(): string {
    return `Key ${this.key} is never selected in ${this.locale}`;
  }
}

/**
 * `bad-operand`: a function can't use its operand's value or type.
 *
 * @category function errors
 * @since 0.1.0
 */
export class BadOperand extends Schema.TaggedError<BadOperand, { readonly brand: unique symbol }>()(
  "BadOperand",
  { span: at, function: Schema.String },
) {
  /** The spec's name for this error. */
  readonly code = "bad-operand";
  override get message(): string {
    return `:${this.function} can't use its operand`;
  }
}

/**
 * `bad-option`: a function can't use an option's value, or the option had
 * to be set by a literal.
 *
 * @category function errors
 * @since 0.1.0
 */
export class BadOption extends Schema.TaggedError<BadOption, { readonly brand: unique symbol }>()(
  "BadOption",
  { span: at, function: Schema.String, option: Schema.String },
) {
  /** The spec's name for this error. */
  readonly code = "bad-option";
  override get message(): string {
    return `:${this.function} can't use option ${this.option}`;
  }
}

/**
 * `bad-variant-key`: a selector can't compare against a key, such as a
 * `:number` key that is neither a number nor a plural category.
 *
 * @category function errors
 * @since 0.1.0
 */
export class BadVariantKey extends Schema.TaggedError<
  BadVariantKey,
  { readonly brand: unique symbol }
>()("BadVariantKey", { span: at, function: Schema.String, key: Schema.String }) {
  /** The spec's name for this error. */
  readonly code = "bad-variant-key";
  override get message(): string {
    return `:${this.function} can't select on key ${this.key}`;
  }
}

/**
 * `unsupported-operation`: a function accepts the request but this
 * implementation can't carry it out.
 *
 * @category function errors
 * @since 0.1.0
 */
export class UnsupportedOperation extends Schema.TaggedError<
  UnsupportedOperation,
  { readonly brand: unique symbol }
>()("UnsupportedOperation", { span: at, function: Schema.String, operation: Schema.String }) {
  /** The spec's name for this error. */
  readonly code = "unsupported-operation";
  override get message(): string {
    return `:${this.function} doesn't support ${this.operation}`;
  }
}

/**
 * `unresolved-variable`: a variable is neither declared nor given as a
 * parameter.
 *
 * @category resolution errors
 * @since 0.1.0
 */
export class UnresolvedVariable extends Schema.TaggedError<
  UnresolvedVariable,
  { readonly brand: unique symbol }
>()("UnresolvedVariable", { span: at, variable: Schema.String }) {
  /** The spec's name for this error. */
  readonly code = "unresolved-variable";
  override get message(): string {
    return `$${this.variable} has no value`;
  }
}

/**
 * `unknown-function`: no function in the registry has this name, or it is a
 * draft and drafts are off.
 *
 * @category resolution errors
 * @since 0.1.0
 */
export class UnknownFunction extends Schema.TaggedError<
  UnknownFunction,
  { readonly brand: unique symbol }
>()("UnknownFunction", { span: at, function: Schema.String }) {
  /** The spec's name for this error. */
  readonly code = "unknown-function";
  override get message(): string {
    return `:${this.function} isn't a known function`;
  }
}

/**
 * `bad-selector`: a selector's value doesn't support selection, so it
 * matches only `*`.
 *
 * @category resolution errors
 * @since 0.1.0
 */
export class BadSelector extends Schema.TaggedError<
  BadSelector,
  { readonly brand: unique symbol }
>()("BadSelector", { span: at, variable: Schema.String }) {
  /** The spec's name for this error. */
  readonly code = "bad-selector";
  override get message(): string {
    return `$${this.variable} can't be selected on`;
  }
}

/**
 * An error a function handler reports: the spec's _Message Function Errors_.
 *
 * @category function errors
 * @since 0.1.0
 */
export const FunctionError = Schema.Union([
  BadOperand,
  BadOption,
  BadVariantKey,
  UnsupportedOperation,
]);

/**
 * @category function errors
 * @since 0.1.0
 */
export type FunctionError = typeof FunctionError.Type;

/**
 * Why a message was rejected or flagged.
 *
 * @category reasons
 * @since 0.1.0
 */
export const Reason = Schema.Union([
  InvalidSyntax,
  DuplicateOptionName,
  VariantKeyMismatch,
  MissingFallbackVariant,
  MissingSelectorAnnotation,
  DuplicateDeclaration,
  DuplicateVariant,
  UnusedLocal,
  UnreachableVariant,
  BadOperand,
  BadOption,
  BadVariantKey,
  UnsupportedOperation,
  UnresolvedVariable,
  UnknownFunction,
  BadSelector,
]);

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
