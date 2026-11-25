/**
 * The project config, `effect-l10n.config.ts`: `defineConfig` types it as
 * it is written, so a locale outside `locales` is a compile error, and
 * `ProjectConfig` loads and decodes it, each target's options with that
 * target's own schema.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import { Severity } from "./Diagnostic";
import { Locale } from "./Locale";
import type { MessageFunction } from "./messageformat/MessageFunction";
import { type Exports, ModuleLoader } from "./ModuleLoader";

/**
 * A schema for a target's options; it may not need services to decode.
 *
 * @category targets
 * @since 0.1.0
 */
export type OptionsSchema = Schema.Top & { readonly DecodingServices: never };

/**
 * A target as the config lists it: its name, its options as written, and
 * the schema that decodes them.
 *
 * @category targets
 * @since 0.1.0
 */
export interface Target<S extends OptionsSchema = OptionsSchema> {
  readonly target: string;
  readonly options: S["Encoded"];
  readonly schema: S;
  /** The implementation the compiler runs; a compiler `Target` sets it. */
  readonly plugin?: unknown;
}

const isTarget = (u: unknown): u is Target =>
  P.isObject(u) && P.isString(u["target"]) && Schema.isSchema(u["schema"]);

/**
 * Declares a target for the config: `defineTarget("web", WebOptions)` gives
 * the `web({ ... })` function a config calls, typed by the schema. It has no
 * implementation, so the compiler reports it as `unknown-target`; target
 * packages use the compiler's `Target.make`, which sets one.
 *
 * @category targets
 * @since 0.1.0
 */
export const defineTarget =
  <S extends OptionsSchema>(target: string, schema: S) =>
  (options: S["Encoded"]): Target<S> => ({ target, options, schema });

const isFunction = (u: unknown): u is MessageFunction =>
  P.isObject(u) && P.isString(u["name"]) && P.isFunction(u["call"]);

const Translations = Schema.Struct({
  format: Schema.Literals(["json", "xliff2"]),
  dir: Schema.String,
});

/**
 * The config schema. Decoding canonicalises locales and fills defaults:
 * no fallbacks, functions, targets or severity overrides, JSON
 * translations in `translations/`, and output in `generated/l10n/`, one
 * directory per target.
 *
 * @category schemas
 * @since 0.1.0
 */
export const Config = Schema.Struct({
  sourceLocale: Locale,
  locales: Schema.NonEmptyArray(Locale),
  fallbacks: Schema.Record(Schema.String, Schema.Array(Locale)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({})),
  ),
  catalogs: Schema.NonEmptyArray(Schema.String),
  outDir: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed("generated/l10n"))),
  translations: Translations.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({ format: "json" as const, dir: "translations" })),
  ),
  functions: Schema.Array(Schema.declare(isFunction, { expected: "a MessageFunction" })).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
  targets: Schema.Array(Schema.declare(isTarget, { expected: "a target" })).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
  severities: Schema.Record(Schema.String, Severity).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({})),
  ),
}).check(
  Schema.makeFilter(
    (config) =>
      Arr.contains(config.locales, config.sourceLocale) ||
      `sourceLocale ${config.sourceLocale} must be one of locales`,
    {
      identifier: "SourceLocaleInLocales",
      title: "sourceLocale in locales",
      description: "sourceLocale is one of locales",
    },
  ),
  Schema.makeFilter(
    (config) =>
      Option.match(
        Arr.findFirst(
          R.keys(config.fallbacks),
          (key) => !Arr.some(config.locales, (locale) => locale === key),
        ),
        { onNone: () => true, onSome: (key) => `fallbacks has ${key}, which isn't in locales` },
      ),
    {
      identifier: "FallbacksForLocales",
      title: "fallbacks for locales",
      description: "every fallbacks key is one of locales",
    },
  ),
);

/**
 * The decoded config.
 *
 * @category models
 * @since 0.1.0
 */
export type Config = typeof Config.Type;

/**
 * A config as written, with its locales as a literal union `L`.
 *
 * @category models
 * @since 0.1.0
 */
export interface Input<L extends string> {
  readonly sourceLocale: NoInfer<L>;
  readonly locales: ReadonlyArray<L>;
  readonly fallbacks?: { readonly [K in NoInfer<L>]?: ReadonlyArray<NoInfer<L>> };
  readonly catalogs: readonly [string, ...Array<string>];
  readonly outDir?: string;
  readonly translations?: typeof Translations.Encoded;
  readonly functions?: ReadonlyArray<MessageFunction>;
  readonly targets?: ReadonlyArray<Target>;
  readonly severities?: R.ReadonlyRecord<string, Severity>;
}

/**
 * Types a config: `sourceLocale` and `fallbacks` must name `locales`.
 *
 * @category constructors
 * @since 0.1.0
 */
export const defineConfig = <const L extends string, const C extends Input<L>>(
  config: C & Input<L>,
): C => config;

/**
 * The locales a config declares, such as `"en" | "de"`.
 *
 * @category type-level
 * @since 0.1.0
 */
export type LocaleOf<C> = C extends { readonly locales: ReadonlyArray<infer L> } ? L : never;

/**
 * A config failed to load or decode; `details` lists each problem with its
 * path.
 *
 * @category errors
 * @since 0.1.0
 */
export class ConfigError extends Schema.TaggedError<
  ConfigError,
  { readonly brand: unique symbol }
>()("ConfigError", { file: Schema.optionalKey(Schema.String), details: Schema.String }) {
  /** effect-l10n's name for this error. */
  readonly code = "config-error";
  override get message(): string {
    return this.file === undefined ? this.details : `${this.file}: ${this.details}`;
  }
}

const formatter = SchemaIssue.makeFormatterDefault();

const configError = (file: Option.Option<string>, prefix: string, error: Schema.SchemaError) => {
  const details = `${prefix}${formatter(error.issue)}`;
  return Option.match(file, {
    onNone: () => new ConfigError({ details }),
    onSome: (path) => new ConfigError({ file: path, details }),
  });
};

/**
 * Decodes a config, then each target's options with its own schema.
 *
 * @category decoding
 * @since 0.1.0
 */
export const decode = (
  input: Exports[string],
  file: Option.Option<string> = Option.none(),
): Effect.Effect<Config, ConfigError> =>
  Schema.decodeUnknownEffect(Config, { errors: "all" })(input).pipe(
    Effect.mapError((error) => configError(file, "", error)),
    Effect.tap((config) =>
      Effect.forEach(
        config.targets,
        (target, index) =>
          Schema.decodeUnknownEffect(target.schema)(target.options).pipe(
            Effect.mapError((error) =>
              configError(file, `targets[${index}] (${target.target}).options: `, error),
            ),
          ),
        { concurrency: 1, discard: true },
      ),
    ),
  );

/**
 * The project config service.
 *
 * @category services
 * @since 0.1.0
 */
export class ProjectConfig extends Context.Service<ProjectConfig, Config>()(
  "@thomasfosterau/effect-l10n/ProjectConfig",
) {
  /** Loads the config module at `file` and decodes its default export. */
  static readonly layer = (file: string): Layer.Layer<ProjectConfig, ConfigError, ModuleLoader> =>
    Layer.effect(
      ProjectConfig,
      Effect.gen(function* () {
        const loader = yield* ModuleLoader;
        const exports = yield* loader
          .load(file)
          .pipe(Effect.mapError((error) => new ConfigError({ file, details: error.message })));
        return yield* decode(exports["default"], Option.some(file));
      }),
    );

  /** A config given as a value, for tests. */
  static readonly layerTest = (config: Input<string>): Layer.Layer<ProjectConfig, ConfigError> =>
    Layer.effect(ProjectConfig, decode(config));
}
