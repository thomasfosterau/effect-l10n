import { assert, describe, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import dataModelErrors from "./__conformance__/data-model-errors.json" with { type: "json" };
import syntax from "./__conformance__/syntax.json" with { type: "json" };
import * as DataModel from "./DataModel";
import { parseResult } from "./Parser";
import { check, validate, validateResult } from "./Validation";

const Suite = Schema.Struct({
  tests: Schema.Array(
    Schema.Struct({
      src: Schema.String,
      expErrors: Schema.optionalKey(Schema.Array(Schema.Struct({ type: Schema.String }))),
    }),
  ),
});

const parsed = (source: string): DataModel.Message =>
  Result.getOrElse(parseResult(source), () => new DataModel.PatternMessage({ pattern: [] }));

/** The codes of a message's diagnostics of one severity, or of a parse failure. */
const codes = (
  source: string,
  severity: "error" | "warning" = "error",
  locale?: string,
): ReadonlyArray<string> =>
  Result.match(parseResult(source), {
    onFailure: (error) => [error.reason.code],
    onSuccess: (message) =>
      check(message, locale === undefined ? {} : { locale })
        .filter((diagnostic) => diagnostic.severity === severity)
        .map((diagnostic) => diagnostic.code),
  });

describe("conformance", () => {
  it.each(
    Schema.decodeSync(Suite)(dataModelErrors).tests.map(
      ({ src, expErrors = [] }) => [src, expErrors.map(({ type }) => type)] as const,
    ),
  )("%j: %j", (source, expected) => {
    assert.deepStrictEqual(codes(source), expected);
  });

  // The syntax suite's messages are valid, apart from those it expects to fail.
  it.each(
    Schema.decodeSync(Suite)(syntax)
      .tests.filter(({ expErrors = [] }) => Arr.isReadonlyArrayEmpty(expErrors))
      .map(({ src }) => src),
  )("%j has no data model errors", (source) => {
    assert.deepStrictEqual(codes(source), []);
  });
});

describe("data model errors", () => {
  it("reports every finding, not just the first", () => {
    assert.deepStrictEqual(codes(".input {$x} .input {$x} .match $x a b {{}} a b {{}}"), [
      "duplicate-declaration",
      "missing-selector-annotation",
      "variant-key-mismatch",
      "variant-key-mismatch",
      "missing-fallback-variant",
      "duplicate-variant",
    ]);
  });

  it("follows .local chains to a selector's function", () => {
    assert.deepStrictEqual(
      codes(".input {$a :number} .local $b = {$a} .local $c = {$b} .match $c * {{}}"),
      [],
    );
  });

  it("compares keys after NFC normalization", () => {
    assert.deepStrictEqual(codes(".input {$x :string} .match $x |é| {{}} |é| {{}} * {{}}"), [
      "duplicate-variant",
    ]);
  });

  it("points at the offending node", () => {
    const [diagnostic] = check(parsed(".input {$x :string} .match $x * {{}} * {{}}"));
    assert.strictEqual(diagnostic?.code, "duplicate-variant");
    const span = Option.getOrUndefined(diagnostic?.span ?? Option.none());
    assert.deepStrictEqual([span?.start, span?.end], [37, 43]);
  });
});

describe("lint warnings", () => {
  it("flags an unused .local", () => {
    assert.deepStrictEqual(codes(".local $x = {1} .local $y = {$x} {{}}", "warning"), [
      "unused-local",
    ]);
  });

  it("flags plural keys a locale never selects", () => {
    const source = ".input {$n :number} .match $n one {{}} few {{}} 0 {{}} * {{}}";
    assert.deepStrictEqual(codes(source, "warning", "en"), ["unreachable-variant"]);
    assert.deepStrictEqual(codes(source, "warning", "pl"), []);
    assert.deepStrictEqual(codes(source, "warning"), []);
    assert.deepStrictEqual(codes(source, "warning", "not a locale!"), []);
  });

  it("uses ordinal categories for select=ordinal and skips exact", () => {
    const ordinal = ".input {$n :number select=ordinal} .match $n two {{}} * {{}}";
    assert.deepStrictEqual(codes(ordinal, "warning", "en"), []);
    const exact = ".input {$n :number select=exact} .match $n two {{}} * {{}}";
    assert.deepStrictEqual(codes(exact, "warning", "en"), []);
  });

  it("doesn't fail validation", () => {
    assert.isTrue(Result.isSuccess(validateResult(parsed(".local $x = {1} {{}}"))));
  });
});

it.effect("validate fails with the first error as the reason", () =>
  Effect.gen(function* () {
    const tag = yield* validate(parsed(".input {$x} .match $x * {{}}")).pipe(
      Effect.flip,
      Effect.map((error) => error.reason._tag),
    );
    assert.strictEqual(tag, "MissingSelectorAnnotation");
  }),
);
