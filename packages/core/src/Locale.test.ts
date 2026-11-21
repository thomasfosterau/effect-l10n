import { assert, describe, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import {
  androidQualifier,
  appleIdentifier,
  fallbackChain,
  fromString,
  InvalidLocale,
  Locale,
  negotiate,
  parentOf,
} from "./Locale";

const locale = (tag: string) =>
  Result.match(fromString(tag), {
    onFailure: (error) => assert.fail(error.message),
    onSuccess: (value) => value,
  });

const locales = (...tags: Arr.NonEmptyArray<string>) => Arr.map(tags, locale);

describe("fromString", () => {
  it("canonicalises case, deprecated subtags and extensions", () => {
    assert.strictEqual(locale("EN-us"), "en-US");
    assert.strictEqual(locale("zh-hant-tw"), "zh-Hant-TW");
    assert.strictEqual(locale("iw"), "he");
    assert.strictEqual(locale("und"), "und");
    assert.strictEqual(locale("de-DE-u-co-phonebk"), "de-DE-u-co-phonebk");
  });

  it("fails with InvalidLocale for a malformed tag", () => {
    Arr.forEach(["", "en_US", "a", "toolongsubtag-x"], (tag) => {
      const result = fromString(tag);
      assert.isTrue(Result.isFailure(result) && result.failure instanceof InvalidLocale, tag);
    });
  });

  it("decodes through the schema", () => {
    assert.strictEqual(Schema.decodeSync(Locale)("FR-ca"), "fr-CA");
    assert.isTrue(Option.isNone(Schema.decodeOption(Locale)("fr_CA")));
  });
});

describe("negotiate", () => {
  const available = locales("en", "en-GB", "de", "zh-Hans", "zh-Hant", "pt-BR");

  it("prefers an exact or truncated match", () => {
    assert.deepStrictEqual(negotiate(["en-GB"], available), Option.some(locale("en-GB")));
    assert.deepStrictEqual(negotiate(["de-CH-u-ca-gregory"], available), Option.some(locale("de")));
    assert.deepStrictEqual(negotiate(["fr", "de"], available), Option.some(locale("de")));
  });

  it("matches the same language and script with best fit only", () => {
    assert.deepStrictEqual(negotiate(["zh-TW"], available), Option.some(locale("zh-Hant")));
    assert.deepStrictEqual(negotiate(["zh-CN"], available), Option.some(locale("zh-Hans")));
    assert.deepStrictEqual(negotiate(["pt-PT"], available), Option.some(locale("pt-BR")));
    assert.isTrue(Option.isNone(negotiate(["pt-PT"], available, "lookup")));
    assert.isTrue(Option.isNone(negotiate(["zh-TW"], available, "lookup")));
  });

  it("skips malformed requests and finds nothing for unrelated ones", () => {
    assert.deepStrictEqual(negotiate(["en_US", "de"], available), Option.some(locale("de")));
    assert.isTrue(Option.isNone(negotiate(["ja", "und"], available)));
  });
});

describe("fallbackChain", () => {
  it("follows CLDR parents, then the source", () => {
    const source = locale("en");
    assert.deepStrictEqual(
      fallbackChain(locale("de-CH"), { source }),
      locales("de-CH", "de", "en"),
    );
    assert.deepStrictEqual(
      fallbackChain(locale("en-AU"), { source }),
      locales("en-AU", "en-001", "en"),
    );
    assert.deepStrictEqual(
      fallbackChain(locale("es-MX"), { source }),
      locales("es-MX", "es-419", "es", "en"),
    );
    assert.deepStrictEqual(
      fallbackChain(locale("zh-Hant-TW"), { source }),
      locales("zh-Hant-TW", "zh-Hant", "en"),
    );
    assert.deepStrictEqual(fallbackChain(locale("en")), locales("en"));
  });

  it("uses an explicit chain instead", () => {
    const fallbacks = { "fr-CA": locales("fr", "en") };
    assert.deepStrictEqual(
      fallbackChain(locale("fr-CA"), { fallbacks, source: locale("en") }),
      locales("fr-CA", "fr", "en"),
    );
  });

  it("gives a non-default script no parent", () => {
    assert.isTrue(Option.isNone(parentOf(locale("sr-Latn"))));
    assert.deepStrictEqual(parentOf(locale("sr-Cyrl-RS")), Option.some(locale("sr-Cyrl")));
    assert.isTrue(Option.isNone(parentOf(locale("und"))));
  });
});

describe("platform identifiers", () => {
  it("maps to Apple identifiers", () => {
    assert.deepStrictEqual(
      Arr.map(locales("en", "pt-BR", "zh-Hans", "es-419", "de-DE-u-co-phonebk"), appleIdentifier),
      ["en", "pt-BR", "zh-Hans", "es-419", "de-DE"],
    );
  });

  it("maps to Android qualifiers", () => {
    assert.deepStrictEqual(
      Arr.map(locales("en", "pt-BR", "zh-Hans", "zh-Hant-TW", "es-419"), androidQualifier),
      ["en", "pt-rBR", "b+zh+Hans", "b+zh+Hant+TW", "b+es+419"],
    );
  });
});
