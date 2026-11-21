/**
 * Locales: canonical BCP 47 tags as a branded `Schema`, negotiation, CLDR
 * fallback chains and each platform's identifier for a locale.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import type * as Brand from "effect/Brand";
import * as Effect from "effect/Effect";
import * as Equivalence_ from "effect/Equivalence";
import * as Option from "effect/Option";
import * as Order_ from "effect/Order";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as Str from "effect/String";
import { bestFit, lookup, parent } from "./internal/negotiation";

/**
 * A canonical BCP 47 language tag, such as `de-CH` or `zh-Hant-TW`.
 *
 * @category models
 * @since 0.1.0
 */
export type Locale = string & Brand.Brand<"Locale">;

/**
 * A string that isn't a well-formed BCP 47 language tag.
 *
 * @category errors
 * @since 0.1.0
 */
export class InvalidLocale extends Schema.TaggedError<
  InvalidLocale,
  { readonly brand: unique symbol }
>()("InvalidLocale", { tag: Schema.String }) {
  /** effect-l10n's name for this error. */
  readonly code = "invalid-locale";
  override get message(): string {
    return `${this.tag} isn't a BCP 47 language tag`;
  }
}

const Canonical = Schema.String.pipe(Schema.brand("Locale"));

/**
 * Canonicalises a tag (`EN-us` becomes `en-US`), or fails with
 * {@link InvalidLocale}.
 *
 * @category constructors
 * @since 0.1.0
 */
export const fromString = (tag: string): Result.Result<Locale, InvalidLocale> =>
  Result.mapError(
    Result.try(() => Intl.getCanonicalLocales(tag)),
    () => new InvalidLocale({ tag }),
  ).pipe(
    Result.flatMap((tags) =>
      Option.match(Arr.head(tags), {
        onNone: () => Result.fail(new InvalidLocale({ tag })),
        onSome: (canonical) => Result.succeed(Canonical.make(canonical)),
      }),
    ),
  );

/**
 * Decodes a string to its canonical {@link Locale}; an invalid tag fails
 * decoding.
 *
 * @category schemas
 * @since 0.1.0
 */
export const Locale: Schema.decodeTo<typeof Canonical, Schema.String> = Schema.String.pipe(
  Schema.decodeTo(
    Canonical,
    SchemaTransformation.transformEffect<string, string>({
      decode: (tag, options) =>
        Result.match(fromString(tag), {
          onFailure: (error) =>
            Effect.fail(new SchemaIssue.InvalidValue({ message: error.message }, tag, options)),
          onSuccess: Effect.succeed,
        }),
      encode: (locale) => Effect.succeed(locale),
    }),
  ),
);

/**
 * Tags are equal when their canonical forms are.
 *
 * @category instances
 * @since 0.1.0
 */
export const Equivalence: Equivalence_.Equivalence<Locale> = Equivalence_.strictEqual();

/**
 * Orders tags by their canonical form.
 *
 * @category instances
 * @since 0.1.0
 */
export const Order: Order_.Order<Locale> = Order_.String;

/**
 * How {@link negotiate} matches: RFC 4647 `lookup` (truncation only), or
 * `best fit`, which also matches a locale of the same language and script.
 *
 * @category negotiation
 * @since 0.1.0
 */
export type Algorithm = "lookup" | "best fit";

/**
 * The available locale that best serves the requested ones, in order of
 * preference, such as a browser's `navigator.languages`. Requested tags that
 * aren't well formed are skipped.
 *
 * @category negotiation
 * @since 0.1.0
 */
export const negotiate = (
  requested: ReadonlyArray<string>,
  available: ReadonlyArray<Locale>,
  algorithm: Algorithm = "best fit",
): Option.Option<Locale> => {
  const valid = Arr.getSuccesses(Arr.map(requested, fromString));
  const match = algorithm === "lookup" ? lookup(valid, available) : bestFit(valid, available);
  return Option.fromUndefinedOr(match).pipe(
    Option.flatMap((tag) => Arr.findFirst(available, (locale) => locale === tag)),
  );
};

/**
 * The CLDR parent of a locale (`de-CH` → `de`, `en-AU` → `en-001`,
 * `zh-Hant` → none), or none for a root-level locale.
 *
 * @category fallback
 * @since 0.1.0
 */
export const parentOf = (locale: Locale): Option.Option<Locale> =>
  Option.map(Option.fromUndefinedOr(parent(locale)), (tag) => Canonical.make(tag));

const ancestors = (locale: Locale): Array<Locale> =>
  Option.match(parentOf(locale), {
    onNone: () => [],
    onSome: (p) => [p, ...ancestors(p)],
  });

/**
 * Where to look when a locale has no translation.
 *
 * @category fallback
 * @since 0.1.0
 */
export interface FallbackOptions {
  /** Explicit chains by locale, such as `{ "de-CH": ["de", "en"] }`. */
  readonly fallbacks?: R.ReadonlyRecord<string, ReadonlyArray<Locale>>;
  /** The source locale, always the last resort. */
  readonly source?: Locale;
}

/**
 * The locales to try for `locale`, itself first: its explicit chain when it
 * has one, otherwise its CLDR ancestors, then the source locale.
 *
 * @category fallback
 * @since 0.1.0
 */
export const fallbackChain = (
  locale: Locale,
  options: FallbackOptions = {},
): Arr.NonEmptyReadonlyArray<Locale> => {
  const explicit = R.get(options.fallbacks ?? {}, locale);
  const rest = Option.getOrElse(explicit, () => ancestors(locale));
  const source = Option.toArray(Option.fromUndefinedOr(options.source));
  return Arr.dedupe(Arr.prepend([...rest, ...source], locale));
};

/**
 * Apple's identifier for a locale (the `.lproj` and String Catalog key):
 * language, script and region, such as `zh-Hans` or `pt-BR`.
 *
 * @category platforms
 * @since 0.1.0
 */
export const appleIdentifier = (locale: Locale): string => {
  const { language, script, region } = new Intl.Locale(locale);
  return Arr.join(
    Arr.getSomes([Option.some(language), ...Arr.map([script, region], Option.fromUndefinedOr)]),
    "-",
  );
};

/**
 * Android's resource qualifier for a locale, after `values-`: `pt-rBR` for
 * a language and two-letter region, the BCP 47 form `b+zh+Hans` otherwise.
 *
 * @category platforms
 * @since 0.1.0
 */
export const androidQualifier = (locale: Locale): string => {
  const { language, script, region } = new Intl.Locale(locale);
  if (script === undefined && region === undefined) return language;
  if (script === undefined && region !== undefined && Str.length(region) === 2) {
    return `${language}-r${region}`;
  }
  return Arr.join(
    Arr.getSomes([Option.some(language), ...Arr.map([script, region], Option.fromUndefinedOr)]),
    "+",
  ).replace(/^/, "b+");
};
