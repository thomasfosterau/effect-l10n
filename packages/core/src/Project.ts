/**
 * The project loader: reads the config's catalogs and translation files
 * into one immutable {@link Project}, with every diagnostic found on the
 * way. Only a config, module or translation file that can't be read fails
 * the load.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Path from "effect/Path";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import { check as checkIds, entries, type Entry, MessageId } from "./Catalog";
import { type Config, ConfigError, ProjectConfig } from "./Config";
import { Diagnostic, InvalidMessageId, report, Severities, type Severity } from "./Diagnostic";
import { fallbackChain, Locale } from "./Locale";
import { Message } from "./Message";
import * as DataModel from "./messageformat/DataModel";
import { parseResult } from "./messageformat/Parser";
import { check as checkMessage } from "./messageformat/Validation";
import { ModuleLoader, type ModuleLoadError } from "./ModuleLoader";
import {
  File as TranslationFile,
  type FileEntry,
  hashSource,
  type Source,
  Translation,
  validateAll,
} from "./Translation";

/**
 * A source message in a project: its ID, the catalog file it came from and,
 * when it parsed, its data model with spans.
 *
 * @category models
 * @since 0.1.0
 */
export class ProjectMessage extends Schema.Class<ProjectMessage, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/ProjectMessage",
)({
  id: Schema.String,
  file: Schema.optionalKey(Schema.String),
  message: Message,
  model: Schema.optionalKey(DataModel.Message),
}) {}

/**
 * A loaded project.
 *
 * @category models
 * @since 0.1.0
 */
export class Project extends Schema.Class<Project, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/Project",
)({
  sourceLocale: Locale,
  locales: Schema.Array(Locale),
  /** Each locale's fallback chain, itself first and the source last. */
  fallbacks: Schema.Record(Schema.String, Schema.NonEmptyArray(Locale)),
  messages: Schema.Array(ProjectMessage),
  translations: Schema.Array(Translation),
  diagnostics: Schema.Array(Diagnostic),
}) {}

/**
 * A translation file couldn't be read or isn't valid JSON of the expected
 * shape.
 *
 * @category errors
 * @since 0.1.0
 */
export class TranslationFileError extends Schema.TaggedError<
  TranslationFileError,
  { readonly brand: unique symbol }
>()("TranslationFileError", { file: Schema.String, details: Schema.String }) {
  /** effect-l10n's name for this error. */
  readonly code = "translation-file-error";
  override get message(): string {
    return `${this.file}: ${this.details}`;
  }
}

/**
 * Why a project failed to load.
 *
 * @category errors
 * @since 0.1.0
 */
export type LoadError = ConfigError | ModuleLoadError | TranslationFileError;

type Overrides = R.ReadonlyRecord<string, Severity>;

const formatter = SchemaIssue.makeFormatterDefault();

/** The message's data model, or the diagnostics that say why it has none. */
const parseMessage = (
  source: string,
  overrides: Overrides,
  location: { readonly file?: string; readonly messageId: string; readonly locale?: string },
): readonly [Option.Option<DataModel.Message>, ReadonlyArray<Diagnostic>] =>
  Result.match(parseResult(source), {
    onFailure: (error) => [
      Option.none(),
      Option.toArray(report(overrides, "error", error.reason, location)),
    ],
    onSuccess: (model) => {
      const found = Arr.getSomes(
        Arr.map(
          checkMessage(
            model,
            Option.match(Option.fromUndefinedOr(location.locale), {
              onNone: () => ({}),
              onSome: (locale) => ({ locale }),
            }),
          ),
          (d) => report(overrides, d.severity, d.reason, location),
        ),
      );
      const invalid = Arr.some(found, (d) => d.severity === "error");
      return [invalid ? Option.none() : Option.some(model), found];
    },
  });

const projectMessage = (entry: Entry, overrides: Overrides) => {
  const file = Option.getOrUndefined(entry.file);
  const location = file === undefined ? { messageId: entry.id } : { messageId: entry.id, file };
  const [model, diagnostics] = parseMessage(entry.message.source, overrides, location);
  const fields = { id: entry.id, message: entry.message };
  const withFile = file === undefined ? fields : { ...fields, file };
  return {
    message: Option.match(model, {
      onNone: () => new ProjectMessage(withFile),
      onSome: (m) => new ProjectMessage({ ...withFile, model: m }),
    }),
    diagnostics,
  };
};

const fileEntry = (entry: FileEntry) => (P.isString(entry) ? { source: entry } : entry);

const translationsOf = (
  file: string,
  decoded: TranslationFile,
  sources: R.ReadonlyRecord<string, string>,
  overrides: Overrides,
): Effect.Effect<
  readonly [ReadonlyArray<Translation>, ReadonlyArray<Diagnostic>],
  TranslationFileError
> =>
  Schema.decodeEffect(Locale)(decoded.locale).pipe(
    Effect.mapError(
      (error) => new TranslationFileError({ file, details: `locale: ${formatter(error.issue)}` }),
    ),
    Effect.map((locale) => {
      const results = Arr.map(R.toEntries(decoded.messages), ([id, raw]) => {
        const entry = fileEntry(raw);
        const location = { file, messageId: id, locale };
        const messageId = Schema.decodeOption(MessageId)(id);
        if (Option.isNone(messageId)) {
          return [
            Option.none<Translation>(),
            Option.toArray(report(overrides, "error", new InvalidMessageId({ id }), location)),
          ] as const;
        }
        const [model, diagnostics] = parseMessage(entry.source, overrides, location);
        const sourceHash =
          entry.sourceHash ??
          Option.getOrElse(Option.map(R.get(sources, id), hashSource), () => "");
        return [
          Option.map(
            model,
            (message) =>
              new Translation({
                messageId: messageId.value,
                locale,
                source: entry.source,
                message,
                state: entry.state ?? "translated",
                sourceHash,
              }),
          ),
          diagnostics,
        ] as const;
      });
      return [
        Arr.getSomes(Arr.map(results, ([t]) => t)),
        Arr.flatMap(results, ([, d]) => d),
      ] as const;
    }),
  );

const decodeFile = Schema.decodeUnknownEffect(Schema.fromJsonString(TranslationFile));

const loadTranslations = Effect.fnUntraced(function* (
  config: Config,
  root: string,
  sources: R.ReadonlyRecord<string, string>,
  overrides: Overrides,
) {
  if (config.translations.format !== "json") {
    return yield* new ConfigError({
      details: `translations.format ${config.translations.format} isn't supported yet; use json`,
    });
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = path.join(root, config.translations.dir);
  const files = yield* fs
    .glob("**/*.json", { root: dir })
    .pipe(
      Effect.mapError((error) => new TranslationFileError({ file: dir, details: error.message })),
    );
  const sorted = Arr.sort(files, Order.String);
  const loaded = yield* Effect.forEach(
    sorted,
    (name) => {
      const file = path.join(config.translations.dir, name);
      return fs.readFileString(path.join(dir, name)).pipe(
        Effect.mapError((error) => new TranslationFileError({ file, details: error.message })),
        Effect.flatMap((text) =>
          decodeFile(text).pipe(
            Effect.mapError(
              (error) => new TranslationFileError({ file, details: formatter(error.issue) }),
            ),
          ),
        ),
        Effect.flatMap((decoded) => translationsOf(file, decoded, sources, overrides)),
        Effect.map(([translations, diagnostics]) => ({ file, translations, diagnostics })),
      );
    },
    { concurrency: 8 },
  );
  return [
    Arr.flatMap(loaded, ({ translations }) => translations),
    Arr.flatMap(loaded, ({ diagnostics }) => diagnostics),
    R.fromEntries(
      Arr.flatMap(loaded, ({ file, translations }) =>
        Arr.map(translations, (t): readonly [string, string] => [
          `${t.locale}\u0000${t.messageId}`,
          file,
        ]),
      ),
    ),
  ] as const;
});

/** A translation finding, with the file of the translation it is about. */
const withFile =
  (files: R.ReadonlyRecord<string, string>) =>
  (diagnostic: Diagnostic): Diagnostic =>
    Option.match(R.get(files, `${diagnostic.locale ?? ""}\u0000${diagnostic.messageId ?? ""}`), {
      onNone: () => diagnostic,
      onSome: (file) =>
        new Diagnostic({
          severity: diagnostic.severity,
          reason: diagnostic.reason,
          file,
          messageId: diagnostic.messageId,
          locale: diagnostic.locale,
        }),
    });

/**
 * Loads the project the `ProjectConfig` describes; `root` is the directory
 * its catalog globs and translations directory are relative to.
 *
 * @category loading
 * @since 0.1.0
 */
export const load = Effect.fn("Project.load")(function* (root = ".") {
  const config = yield* ProjectConfig;
  const loader = yield* ModuleLoader;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const overrides: Overrides = { ...(yield* Severities), ...config.severities };

  const matched = yield* Effect.forEach(
    config.catalogs,
    (pattern) =>
      fs
        .glob(pattern, { root })
        .pipe(
          Effect.mapError((error) => new ConfigError({ details: `catalogs: ${error.message}` })),
        ),
    { concurrency: 1 },
  );
  const files = Arr.dedupe(Arr.sort(Arr.flatten(matched), Order.String));
  const found = yield* Effect.forEach(
    files,
    (file) =>
      Effect.map(loader.load(path.join(root, file)), (exports) =>
        entries(exports, Option.some(file)),
      ),
    { concurrency: 8 },
  );
  const all = Arr.flatten(found);
  const messages = Arr.map(all, (entry) => projectMessage(entry, overrides));
  const sources = R.fromEntries(Arr.map(all, (entry) => [entry.id, entry.message.source]));
  const [translations, translationDiagnostics, translationFiles] = yield* loadTranslations(
    config,
    root,
    sources,
    overrides,
  );
  const validated: ReadonlyArray<Source> = Arr.filterMap(messages, ({ message }) =>
    message.model === undefined
      ? Result.failVoid
      : Result.succeed({
          id: message.id,
          source: message.message.source,
          message: message.model,
          doNotTranslate: message.message.doNotTranslate ?? false,
        }),
  );
  const targets = Arr.filter(config.locales, (locale) => locale !== config.sourceLocale);
  return new Project({
    sourceLocale: config.sourceLocale,
    locales: config.locales,
    fallbacks: R.fromEntries(
      Arr.map(config.locales, (locale) => [
        locale,
        fallbackChain(locale, { fallbacks: config.fallbacks, source: config.sourceLocale }),
      ]),
    ),
    messages: Arr.map(messages, ({ message }) => message),
    translations,
    diagnostics: [
      ...checkIds(all, overrides),
      ...Arr.flatMap(messages, ({ diagnostics }) => diagnostics),
      ...translationDiagnostics,
      ...Arr.map(
        validateAll(validated, translations, targets, overrides),
        withFile(translationFiles),
      ),
    ],
  });
});
