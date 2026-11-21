/**
 * Findings about a project: invalid or colliding message IDs, translations
 * that don't match their source, and the MessageFormat 2 engine's own
 * diagnostics, each with where it was found. Findings accumulate; none
 * stops the load.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Option from "effect/Option";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import * as MessageFormatError from "./messageformat/MessageFormatError";

const ids = Schema.Array(Schema.String);

/**
 * `invalid-message-id`: an ID isn't a dotted path of identifiers every
 * target accepts.
 *
 * @category reasons
 * @since 0.1.0
 */
export class InvalidMessageId extends Schema.TaggedError<
  InvalidMessageId,
  { readonly brand: unique symbol }
>()("InvalidMessageId", { id: Schema.String }) {
  /** effect-l10n's name for this finding. */
  readonly code = "invalid-message-id";
  override get message(): string {
    return `${this.id} isn't a valid message ID`;
  }
}

/**
 * `duplicate-message-id`: two messages have the same ID.
 *
 * @category reasons
 * @since 0.1.0
 */
export class DuplicateMessageId extends Schema.TaggedError<
  DuplicateMessageId,
  { readonly brand: unique symbol }
>()("DuplicateMessageId", { id: Schema.String, files: ids }) {
  /** effect-l10n's name for this finding. */
  readonly code = "duplicate-message-id";
  override get message(): string {
    return `${this.id} is defined more than once`;
  }
}

/**
 * `message-id-collision`: distinct IDs map to the same identifier on a
 * target, such as `fooBar` and `foo_bar` on Android.
 *
 * @category reasons
 * @since 0.1.0
 */
export class MessageIdCollision extends Schema.TaggedError<
  MessageIdCollision,
  { readonly brand: unique symbol }
>()("MessageIdCollision", { platform: Schema.String, identifier: Schema.String, ids }) {
  /** effect-l10n's name for this finding. */
  readonly code = "message-id-collision";
  override get message(): string {
    return `${Arr.join(this.ids, ", ")} all become ${this.identifier} on ${this.platform}`;
  }
}

/**
 * `unknown-variable`: a translation reads a variable its source doesn't.
 *
 * @category reasons
 * @since 0.1.0
 */
export class UnknownVariable extends Schema.TaggedError<
  UnknownVariable,
  { readonly brand: unique symbol }
>()("UnknownVariable", { variable: Schema.String }) {
  /** effect-l10n's name for this finding. */
  readonly code = "unknown-variable";
  override get message(): string {
    return `$${this.variable} isn't a parameter of the source message`;
  }
}

/**
 * `missing-variable`: a translation never reads one of its source's
 * parameters.
 *
 * @category reasons
 * @since 0.1.0
 */
export class MissingVariable extends Schema.TaggedError<
  MissingVariable,
  { readonly brand: unique symbol }
>()("MissingVariable", { variable: Schema.String }) {
  /** effect-l10n's name for this finding. */
  readonly code = "missing-variable";
  override get message(): string {
    return `$${this.variable} from the source message is never used`;
  }
}

/**
 * `selector-mismatch`: a translation selects on a variable through a
 * different function than its source does.
 *
 * @category reasons
 * @since 0.1.0
 */
export class SelectorMismatch extends Schema.TaggedError<
  SelectorMismatch,
  { readonly brand: unique symbol }
>()("SelectorMismatch", {
  variable: Schema.String,
  expected: Schema.String,
  actual: Schema.String,
}) {
  /** effect-l10n's name for this finding. */
  readonly code = "selector-mismatch";
  override get message(): string {
    return `$${this.variable} is selected with :${this.actual}, not :${this.expected}`;
  }
}

/**
 * `missing-plural-category`: a plural selector has no variant for some of
 * the target locale's CLDR plural categories, which fall to `*`.
 *
 * @category reasons
 * @since 0.1.0
 */
export class MissingPluralCategory extends Schema.TaggedError<
  MissingPluralCategory,
  { readonly brand: unique symbol }
>()("MissingPluralCategory", { variable: Schema.String, categories: ids }) {
  /** effect-l10n's name for this finding. */
  readonly code = "missing-plural-category";
  override get message(): string {
    return `$${this.variable} has no variant for ${Arr.join(this.categories, ", ")}`;
  }
}

/**
 * `missing-translation`: a locale has no translation of a message, so it
 * falls back along its chain.
 *
 * @category reasons
 * @since 0.1.0
 */
export class MissingTranslation extends Schema.TaggedError<
  MissingTranslation,
  { readonly brand: unique symbol }
>()("MissingTranslation", {}) {
  /** effect-l10n's name for this finding. */
  readonly code = "missing-translation";
  override get message(): string {
    return "No translation";
  }
}

/**
 * `extra-translation`: a translation's message is no longer in the source.
 *
 * @category reasons
 * @since 0.1.0
 */
export class ExtraTranslation extends Schema.TaggedError<
  ExtraTranslation,
  { readonly brand: unique symbol }
>()("ExtraTranslation", {}) {
  /** effect-l10n's name for this finding. */
  readonly code = "extra-translation";
  override get message(): string {
    return "The source message was removed";
  }
}

/**
 * `stale-translation`: the source message changed after it was translated.
 *
 * @category reasons
 * @since 0.1.0
 */
export class StaleTranslation extends Schema.TaggedError<
  StaleTranslation,
  { readonly brand: unique symbol }
>()("StaleTranslation", {}) {
  /** effect-l10n's name for this finding. */
  readonly code = "stale-translation";
  override get message(): string {
    return "The source message changed since this was translated";
  }
}

/**
 * Why a project was flagged: a reason above, or one from the MessageFormat
 * 2 engine about a message or translation.
 *
 * @category reasons
 * @since 0.1.0
 */
export const Reason = Schema.Union([
  InvalidMessageId,
  DuplicateMessageId,
  MessageIdCollision,
  UnknownVariable,
  MissingVariable,
  SelectorMismatch,
  MissingPluralCategory,
  MissingTranslation,
  ExtraTranslation,
  StaleTranslation,
  MessageFormatError.Reason,
]);

/**
 * @category reasons
 * @since 0.1.0
 */
export type Reason = typeof Reason.Type;

/**
 * How seriously to take a finding; `off` drops it.
 *
 * @category models
 * @since 0.1.0
 */
export const Severity = Schema.Literals(["error", "warning", "off"]);

/**
 * @category models
 * @since 0.1.0
 */
export type Severity = typeof Severity.Type;

/**
 * One finding, with where it was found.
 *
 * @category models
 * @since 0.1.0
 */
export class Diagnostic extends Schema.Class<Diagnostic, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/Diagnostic",
)({
  severity: Schema.Literals(["error", "warning"]),
  reason: Reason,
  file: Schema.optional(Schema.String),
  messageId: Schema.optional(Schema.String),
  locale: Schema.optional(Schema.String),
}) {
  /** The finding's code, as listed in `Reason`. */
  get code(): Reason["code"] {
    return this.reason.code;
  }
  get message(): string {
    return this.reason.message;
  }
}

/**
 * Severity overrides by code, such as `{ "missing-translation": "error" }`,
 * usually from the project config.
 *
 * @category services
 * @since 0.1.0
 */
export const Severities = Context.Reference<R.ReadonlyRecord<string, Severity>>(
  "@thomasfosterau/effect-l10n/Diagnostic/Severities",
  { defaultValue: () => ({}) },
);

/**
 * Where a finding was made.
 *
 * @category models
 * @since 0.1.0
 */
export interface Location {
  readonly file?: string;
  readonly messageId?: string;
  readonly locale?: string;
}

/**
 * A finding at its default severity, unless `overrides` changes it; none
 * when it is turned off.
 *
 * @category constructors
 * @since 0.1.0
 */
export const report = (
  overrides: R.ReadonlyRecord<string, Severity>,
  severity: "error" | "warning",
  reason: Reason,
  location: Location = {},
): Option.Option<Diagnostic> => {
  const effective = Option.getOrElse(R.get(overrides, reason.code), () => severity);
  return effective === "off"
    ? Option.none()
    : Option.some(new Diagnostic({ severity: effective, reason, ...location }));
};
