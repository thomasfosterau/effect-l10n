/**
 * Translations: a non-source locale's version of each message, read from
 * interchange files, and their validation against the source message.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Hash from "effect/Hash";
import * as Option from "effect/Option";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { MessageId } from "./Catalog";
import {
  type Diagnostic,
  ExtraTranslation,
  MissingPluralCategory,
  MissingTranslation,
  MissingVariable,
  report,
  SelectorMismatch,
  type Severity,
  StaleTranslation,
  UnknownVariable,
} from "./Diagnostic";
import { Locale } from "./Locale";
import * as DataModel from "./messageformat/DataModel";
import { functionOf, selectionKind } from "./messageformat/internal/declarations";
import { params } from "./messageformat/Params";

/**
 * Where a translation is in its workflow. `stale` means its source changed
 * after it was translated.
 *
 * @category models
 * @since 0.1.0
 */
export const State = Schema.Literals(["new", "translated", "reviewed", "final", "stale"]);

/**
 * @category models
 * @since 0.1.0
 */
export type State = typeof State.Type;

/**
 * One message in one locale.
 *
 * @category models
 * @since 0.1.0
 */
export class Translation extends Schema.Class<Translation, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/Translation",
)({
  messageId: MessageId,
  locale: Locale,
  /** The MessageFormat 2 source. */
  source: Schema.String,
  /** The parsed source. */
  message: DataModel.Message,
  state: State,
  /** {@link hashSource} of the source message it was translated from. */
  sourceHash: Schema.String,
}) {}

/**
 * A stable hash of a source message, stored with its translations to tell
 * when they go stale.
 *
 * @category models
 * @since 0.1.0
 */
export const hashSource = (source: string): string =>
  (Hash.string(source) >>> 0).toString(16).padStart(8, "0");

/**
 * One entry of a translation file: the source alone, or with its state and
 * the hash of the source message it translates.
 *
 * @category files
 * @since 0.1.0
 */
export const FileEntry = Schema.Union([
  Schema.String,
  Schema.Struct({
    source: Schema.String,
    state: Schema.optionalKey(State),
    sourceHash: Schema.optionalKey(Schema.String),
  }),
]);

/**
 * @category files
 * @since 0.1.0
 */
export type FileEntry = typeof FileEntry.Type;

/**
 * The JSON translation file: a locale and its messages by ID.
 *
 * @category files
 * @since 0.1.0
 */
export const File = Schema.Struct({
  locale: Schema.String,
  messages: Schema.Record(Schema.String, FileEntry),
});

/**
 * @category files
 * @since 0.1.0
 */
export type File = typeof File.Type;

/**
 * Translations maintained in TypeScript rather than a file, for a locale
 * developers keep themselves. Each counts as `final`.
 *
 * @category files
 * @since 0.1.0
 */
export const forLocale = (locale: string, messages: R.ReadonlyRecord<string, string>): File => ({
  locale,
  messages: R.map(messages, (source) => ({ source, state: "final" as const })),
});

/** A source message as validation sees it. */
export interface Source {
  readonly id: string;
  readonly source: string;
  readonly message: DataModel.Message;
  readonly doNotTranslate: boolean;
}

const variables = (message: DataModel.Message): ReadonlyArray<string> =>
  Arr.map(params(message), (param) => param.name);

const selectors = (
  message: DataModel.Message,
): ReadonlyArray<readonly [name: string, fn: Option.Option<DataModel.FunctionRef>]> =>
  message.type === "select"
    ? Arr.map(message.selectors, (selector) => [selector.name, functionOf(message, selector.name)])
    : [];

/** The plural rule type a selector's function selects with, if any. */
const pluralType = (fn: DataModel.FunctionRef): Option.Option<Intl.PluralRuleType> => {
  const kind = selectionKind(fn);
  return kind === "plural"
    ? Option.some("cardinal")
    : kind === "ordinal"
      ? Option.some("ordinal")
      : Option.none();
};

const missingCategories = (
  message: DataModel.SelectMessage,
  index: number,
  locale: string,
  type: Intl.PluralRuleType,
): ReadonlyArray<string> => {
  const keys = Arr.filterMap(message.variants, (variant) => {
    const key = variant.keys[index];
    return key?.type === "literal" ? Result.succeed(key.value) : Result.failVoid;
  });
  const categories = new Intl.PluralRules(locale, { type }).resolvedOptions().pluralCategories;
  return Arr.filter(
    categories,
    (category) => category !== "other" && !Arr.contains(keys, category),
  );
};

const pluralDiagnostics = (translation: Translation): ReadonlyArray<MissingPluralCategory> => {
  const message = translation.message;
  if (message.type !== "select") return [];
  return Arr.filterMap(selectors(message), ([name, fn], index) =>
    Option.flatMap(fn, pluralType).pipe(
      Option.map((type) => missingCategories(message, index, translation.locale, type)),
      Option.filter(Arr.isReadonlyArrayNonEmpty),
      Option.match({
        onNone: () => Result.failVoid,
        onSome: (categories) =>
          Result.succeed(new MissingPluralCategory({ variable: name, categories })),
      }),
    ),
  );
};

const selectorDiagnostics = (
  source: Source,
  translation: Translation,
): ReadonlyArray<SelectorMismatch> => {
  const expected = R.fromEntries(selectors(source.message));
  return Arr.filterMap(selectors(translation.message), ([name, fn]) => {
    const want = Option.flatten(R.get(expected, name));
    const [a, b] = [Option.map(want, (f) => f.name), Option.map(fn, (f) => f.name)];
    return Option.isSome(a) && Option.getOrElse(b, () => "") !== a.value
      ? Result.succeed(
          new SelectorMismatch({
            variable: name,
            expected: a.value,
            actual: Option.getOrElse(b, () => "(none)"),
          }),
        )
      : Result.failVoid;
  });
};

/**
 * Every finding about one translation of a source message: variables it
 * reads that the source doesn't, or never reads; selectors read through
 * another function; the target locale's plural categories it has no
 * variant for; and a source that changed since.
 *
 * @category validation
 * @since 0.1.0
 */
export const validate = (
  source: Source,
  translation: Translation,
  overrides: R.ReadonlyRecord<string, Severity> = {},
): ReadonlyArray<Diagnostic> => {
  const location = { messageId: translation.messageId, locale: translation.locale };
  const expected = variables(source.message);
  const actual = variables(translation.message);
  const errors = [
    ...Arr.map(
      Arr.filter(actual, (name) => !Arr.contains(expected, name)),
      (variable) => report(overrides, "error", new UnknownVariable({ variable }), location),
    ),
    ...Arr.map(selectorDiagnostics(source, translation), (reason) =>
      report(overrides, "error", reason, location),
    ),
  ];
  const warnings = [
    ...Arr.map(
      Arr.filter(expected, (name) => !Arr.contains(actual, name)),
      (variable) => report(overrides, "warning", new MissingVariable({ variable }), location),
    ),
    ...Arr.map(pluralDiagnostics(translation), (reason) =>
      report(overrides, "warning", reason, location),
    ),
    translation.sourceHash === hashSource(source.source)
      ? Option.none()
      : report(overrides, "warning", new StaleTranslation({}), location),
  ];
  return Arr.getSomes([...errors, ...warnings]);
};

/**
 * Every finding about a project's translations: each one's {@link validate}
 * findings, translations of removed messages, and messages a locale has no
 * translation of (unless marked do-not-translate).
 *
 * @category validation
 * @since 0.1.0
 */
export const validateAll = (
  sources: ReadonlyArray<Source>,
  translations: ReadonlyArray<Translation>,
  locales: ReadonlyArray<string>,
  overrides: R.ReadonlyRecord<string, Severity> = {},
): ReadonlyArray<Diagnostic> => {
  const byId = R.fromEntries(Arr.map(sources, (source) => [source.id, source]));
  const checked = Arr.flatMap(translations, (translation) =>
    Option.match(R.get(byId, translation.messageId), {
      onNone: () =>
        Option.toArray(
          report(overrides, "warning", new ExtraTranslation({}), {
            messageId: translation.messageId,
            locale: translation.locale,
          }),
        ),
      onSome: (source) => validate(source, translation, overrides),
    }),
  );
  const missing = Arr.flatMap(locales, (locale) =>
    Arr.filterMap(sources, (source) =>
      source.doNotTranslate ||
      Arr.some(translations, (t) => t.locale === locale && t.messageId === source.id)
        ? Result.failVoid
        : Result.succeed(
            report(overrides, "warning", new MissingTranslation({}), {
              messageId: source.id,
              locale,
            }),
          ),
    ),
  );
  return [...checked, ...Arr.getSomes(missing)];
};

/**
 * The translation to use for a message: the first locale in the chain that
 * has one; none means the source message.
 *
 * @category resolution
 * @since 0.1.0
 */
export const resolve = (
  translations: ReadonlyArray<Translation>,
  messageId: string,
  chain: ReadonlyArray<string>,
): Option.Option<Translation> =>
  Arr.findFirst(chain, (locale) =>
    Arr.findFirst(translations, (t) => t.locale === locale && t.messageId === messageId),
  );
