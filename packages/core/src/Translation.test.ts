import { assert, describe, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { MessageId } from "./Catalog";
import { Locale } from "./Locale";
import { parseResult } from "./messageformat/Parser";
import {
  forLocale,
  hashSource,
  resolve,
  type Source,
  Translation,
  validate,
  validateAll,
} from "./Translation";

const parse = (source: string) =>
  Result.match(parseResult(source), {
    onFailure: (error) => assert.fail(error.message),
    onSuccess: (message) => message,
  });

const source = (id: string, text: string, doNotTranslate = false): Source => ({
  id,
  source: text,
  message: parse(text),
  doNotTranslate,
});

const translation = (
  of: Source,
  locale: string,
  text: string,
  sourceHash = hashSource(of.source),
) =>
  new Translation({
    messageId: Schema.decodeSync(MessageId)(of.id),
    locale: Schema.decodeSync(Locale)(locale),
    source: text,
    message: parse(text),
    state: "translated",
    sourceHash,
  });

const codes = (diagnostics: ReadonlyArray<{ readonly code: string }>) =>
  Arr.map(diagnostics, (d) => d.code);

const items = source(
  "items",
  ".input {$count :number} .match $count one {{{$count} item for {$name}}} * {{{$count} items for {$name}}}",
);

describe("validate", () => {
  it("accepts a faithful translation", () => {
    const de = translation(
      items,
      "de",
      ".input {$count :number} .match $count one {{{$count} Artikel für {$name}}} * {{{$count} Artikel für {$name}}}",
    );
    assert.deepStrictEqual(validate(items, de), []);
  });

  it("reports unknown and missing variables", () => {
    const de = translation(
      items,
      "de",
      ".input {$count :number} .match $count one {{{$count} Artikel für {$user}}} * {{{$count} Artikel}}",
    );
    assert.deepStrictEqual(codes(validate(items, de)), ["unknown-variable", "missing-variable"]);
  });

  it("reports a selector read through another function", () => {
    const de = translation(
      items,
      "de",
      ".input {$count :string} .match $count one {{{$count} {$name}}} * {{{$count} {$name}}}",
    );
    assert.deepStrictEqual(codes(validate(items, de)), ["selector-mismatch"]);
  });

  it("follows a selector through declarations without a function", () => {
    const aliased = source(
      "aliased",
      ".input {$n :integer} .local $m = {$n} .match $m one {{one}} * {{{$n}}}",
    );
    const de = translation(aliased, "de", ".input {$n :integer} .match $n one {{eins}} * {{{$n}}}");
    assert.deepStrictEqual(validate(aliased, de), []);
    const mismatched = translation(
      aliased,
      "de",
      ".input {$n :string} .local $m = {$n} .match $m one {{eins}} * {{{$n}}}",
    );
    assert.deepStrictEqual(codes(validate(aliased, mismatched)), ["selector-mismatch"]);
  });

  it("reports the target locale's missing plural categories", () => {
    const pl = translation(
      items,
      "pl",
      ".input {$count :number} .match $count one {{{$count} {$name}}} * {{{$count} {$name}}}",
    );
    const [finding] = validate(items, pl);
    assert.strictEqual(finding?.code, "missing-plural-category");
    assert.deepStrictEqual(
      finding?.reason._tag === "MissingPluralCategory" ? finding.reason.categories : [],
      ["few", "many"],
    );
  });

  it("skips exact selection and counts ordinal categories", () => {
    const exact = source(
      "exact",
      ".input {$n :number select=exact} .match $n 1 {{one}} * {{{$n}}}",
    );
    assert.deepStrictEqual(
      validate(
        exact,
        translation(
          exact,
          "pl",
          ".input {$n :number select=exact} .match $n 1 {{jeden}} * {{{$n}}}",
        ),
      ),
      [],
    );
    const ordinal = source(
      "place",
      ".input {$n :number select=ordinal} .match $n one {{{$n}st}} two {{{$n}nd}} few {{{$n}rd}} * {{{$n}th}}",
    );
    assert.deepStrictEqual(validate(ordinal, translation(ordinal, "en", ordinal.source)), []);
    assert.deepStrictEqual(
      codes(
        validate(
          ordinal,
          translation(
            ordinal,
            "en",
            ".input {$n :number select=ordinal} .match $n one {{{$n}st}} * {{{$n}th}}",
          ),
        ),
      ),
      ["missing-plural-category"],
    );
  });

  it("reports a stale translation", () => {
    const de = translation(items, "de", items.source, "00000000");
    assert.deepStrictEqual(codes(validate(items, de)), ["stale-translation"]);
  });

  it("applies severity overrides", () => {
    const de = translation(items, "de", items.source, "00000000");
    assert.deepStrictEqual(validate(items, de, { "stale-translation": "off" }), []);
    const [finding] = validate(items, de, { "stale-translation": "error" });
    assert.strictEqual(finding?.severity, "error");
  });
});

describe("validateAll", () => {
  const brand = source("brand", "Acme", true);
  const removed = source("removed", "Gone");

  it("reports extra and missing translations, but not do-not-translate ones", () => {
    const diagnostics = validateAll(
      [items, brand],
      [translation(items, "de", items.source), translation(removed, "de", "Weg")],
      ["de", "fr"],
    );
    assert.deepStrictEqual(
      Arr.map(diagnostics, (d) => [d.code, d.messageId, d.locale]),
      [
        ["extra-translation", "removed", "de"],
        ["missing-translation", "items", "fr"],
      ],
    );
  });
});

describe("resolve", () => {
  it("takes the first locale in the chain with a translation", () => {
    const fr = translation(items, "fr", items.source);
    assert.deepStrictEqual(resolve([fr], "items", ["fr-CA", "fr", "en"]), Option.some(fr));
    assert.isTrue(Option.isNone(resolve([fr], "items", ["de", "en"])));
  });
});

describe("forLocale", () => {
  it("marks TypeScript-maintained translations final", () => {
    assert.deepStrictEqual(forLocale("en-GB", { items: "{$count} things" }), {
      locale: "en-GB",
      messages: { items: { source: "{$count} things", state: "final" } },
    });
  });
});
