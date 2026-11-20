import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Eq from "effect/Equal";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import bidi from "./__conformance__/bidi.json" with { type: "json" };
import dataModelErrors from "./__conformance__/data-model-errors.json" with { type: "json" };
import syntaxErrors from "./__conformance__/syntax-errors.json" with { type: "json" };
import syntax from "./__conformance__/syntax.json" with { type: "json" };
import * as DataModel from "./DataModel";
import { MessageFormatError } from "./MessageFormatError";
import { parse, parseResult } from "./Parser";

/** The parts of a conformance test file the parser cares about. */
const Suite = Schema.Struct({
  defaultTestProperties: Schema.optionalKey(
    Schema.Struct({
      expErrors: Schema.optionalKey(Schema.Array(Schema.Struct({ type: Schema.String }))),
    }),
  ),
  tests: Schema.Array(
    Schema.Struct({
      src: Schema.String,
      expErrors: Schema.optionalKey(Schema.Array(Schema.Struct({ type: Schema.String }))),
    }),
  ),
});

/** Each test's source and the error code the parser should report, if any. */
const cases = (suite: typeof Suite.Type) =>
  suite.tests.map(({ src, expErrors = suite.defaultTestProperties?.expErrors ?? [] }) => {
    const parserError = expErrors
      .map(({ type }) => type)
      .find((type) => type === "syntax-error" || type === "duplicate-option-name");
    return [src, parserError ?? "ok"] as const;
  });

const decodeSuite = Schema.decodeUnknownSync(Suite);
const syntaxCases = cases(decodeSuite(syntax));
const syntaxErrorCases = cases(decodeSuite(syntaxErrors));

const outcome = (source: string): string => {
  const result = parseResult(source);
  return Result.isSuccess(result) ? "ok" : result.failure.reason.code;
};

describe("conformance", () => {
  it.each([
    ...syntaxCases,
    ...syntaxErrorCases,
    ...cases(decodeSuite(dataModelErrors)),
    ...cases(decodeSuite(bidi)),
  ])("%j: %s", (source, expected) => {
    assert.strictEqual(outcome(source), expected);
  });

  it("covers both outcomes", () => {
    assert.isAbove(syntaxErrorCases.length, 100);
    assert.isAbove(syntaxCases.filter(([, expected]) => expected === "ok").length, 100);
  });
});

const v = (name: string) => new DataModel.VariableRef({ name });
const lit = (value: string) => new DataModel.Literal({ value });
const fn = (name: string, options: DataModel.Options = {}) =>
  new DataModel.FunctionRef({ name, options });

/** The message `source` parses to, or a description of the failure. */
const parsed = (source: string): DataModel.Message | string =>
  Result.match(parseResult(source), {
    onSuccess: (message) => message,
    onFailure: (error) => `${source} failed: ${error.message}`,
  });

/** Whether `source` parses to `expected`, spans aside. */
const parsesTo = (source: string, expected: DataModel.Message): boolean =>
  Eq.equals(parsed(source), expected);

describe("the data model", () => {
  it("keeps a simple message's whitespace and processes escapes", () => {
    assert.isTrue(
      parsesTo(
        " Hi \\{there\\} \\\\ {$name}! ",
        new DataModel.PatternMessage({
          pattern: [" Hi {there} \\ ", new DataModel.VariableExpression({ arg: v("name") }), "! "],
        }),
      ),
    );
  });

  it("parses the empty message", () => {
    assert.isTrue(parsesTo("", new DataModel.PatternMessage({ pattern: [] })));
  });

  it("parses expressions, options and attributes", () => {
    assert.isTrue(
      parsesTo(
        "{|a \\| b| :ns:fn opt=$x other=1.5 @a @b=|c|}{:datetime}{-3}",
        new DataModel.PatternMessage({
          pattern: [
            new DataModel.LiteralExpression({
              arg: lit("a | b"),
              function: fn("ns:fn", { opt: v("x"), other: lit("1.5") }),
              attributes: { a: true, b: lit("c") },
            }),
            new DataModel.FunctionExpression({ function: fn("datetime") }),
            new DataModel.LiteralExpression({ arg: lit("-3") }),
          ],
        }),
      ),
    );
  });

  it("keeps the last of repeated attributes", () => {
    assert.isTrue(
      parsesTo(
        "{$x @a=|1| @a}",
        new DataModel.PatternMessage({
          pattern: [new DataModel.VariableExpression({ arg: v("x"), attributes: { a: true } })],
        }),
      ),
    );
  });

  it("parses markup", () => {
    assert.isTrue(
      parsesTo(
        "{#a href=$url}x{/a}{#br/}{ #img src=|i.png| @x /}",
        new DataModel.PatternMessage({
          pattern: [
            new DataModel.Markup({ kind: "open", name: "a", options: { href: v("url") } }),
            "x",
            new DataModel.Markup({ kind: "close", name: "a" }),
            new DataModel.Markup({ kind: "standalone", name: "br" }),
            new DataModel.Markup({
              kind: "standalone",
              name: "img",
              options: { src: lit("i.png") },
              attributes: { x: true },
            }),
          ],
        }),
      ),
    );
  });

  it("parses declarations and a matcher", () => {
    assert.isTrue(
      parsesTo(
        ".input {$count :number} .local $n = {$count} .match $count $n\n1 * {{One}}\n* * {{{$n} items}}",
        new DataModel.SelectMessage({
          declarations: [
            new DataModel.InputDeclaration({
              value: new DataModel.VariableExpression({ arg: v("count"), function: fn("number") }),
            }),
            new DataModel.LocalDeclaration({
              name: "n",
              value: new DataModel.VariableExpression({ arg: v("count") }),
            }),
          ],
          selectors: [v("count"), v("n")],
          variants: [
            new DataModel.Variant({
              keys: [lit("1"), new DataModel.CatchallKey({})],
              value: ["One"],
            }),
            new DataModel.Variant({
              keys: [new DataModel.CatchallKey({}), new DataModel.CatchallKey({})],
              value: [new DataModel.VariableExpression({ arg: v("n") }), " items"],
            }),
          ],
        }),
      ),
    );
  });

  it("keeps a quoted pattern's whitespace but not the message's", () => {
    assert.isTrue(parsesTo("  {{ a }}\n", new DataModel.PatternMessage({ pattern: [" a "] })));
  });

  it("leaves bidi marks out of names", () => {
    assert.isTrue(
      parsesTo(
        "{$‎x‏ :⁦f⁩}",
        new DataModel.PatternMessage({
          pattern: [new DataModel.VariableExpression({ arg: v("x"), function: fn("f") })],
        }),
      ),
    );
  });

  it("keeps unpaired surrogates in text and quoted literals", () => {
    assert.isTrue(
      parsesTo(
        "\uD800{|\uDC00|}",
        new DataModel.PatternMessage({
          pattern: ["\uD800", new DataModel.LiteralExpression({ arg: lit("\uDC00") })],
        }),
      ),
    );
  });

  it("records spans", () => {
    const message = parsed("Hi {$name :string}");
    assert.instanceOf(message, DataModel.PatternMessage);
    if (!(message instanceof DataModel.PatternMessage)) return;
    const expression = message.pattern[1];
    assert.instanceOf(expression, DataModel.VariableExpression);
    assert.deepStrictEqual(
      [message.span, expression.span, expression.arg.span, expression.function?.span].map(
        (span) => [span?.start, span?.end],
      ),
      [
        [0, 18],
        [3, 18],
        [4, 9],
        [10, 17],
      ],
    );
  });
});

describe("errors", () => {
  it("points at the problem", () => {
    const result = parseResult("Hi {$name :}");
    assert.isTrue(Result.isFailure(result));
    if (Result.isFailure(result)) {
      assert.strictEqual(result.failure.reason._tag, "InvalidSyntax");
      assert.strictEqual(result.failure.reason.span?.start, 11);
    }
  });

  it("reports a duplicate option name with its option's span", () => {
    const result = parseResult("{:f a=1 a=2}");
    assert.isTrue(Result.isFailure(result));
    if (Result.isFailure(result)) {
      assert.strictEqual(result.failure.reason._tag, "DuplicateOptionName");
      assert.deepStrictEqual(
        [result.failure.reason.span?.start, result.failure.reason.span?.end],
        [8, 11],
      );
    }
  });

  it.effect("the Effect API fails with the tagged error", () =>
    Effect.gen(function* () {
      const reason = yield* parse("{").pipe(
        Effect.flip,
        Effect.map((error) => error.reason._tag),
      );
      assert.strictEqual(reason, "InvalidSyntax");
      const handled = yield* parse("{").pipe(
        Effect.catchReason("MessageFormatError", "InvalidSyntax", () => Effect.succeed("caught")),
      );
      assert.strictEqual(handled, "caught");
    }),
  );
});

// Text built from MF2's punctuation, to reach deep into the grammar.
const Mf2ish = Schema.String.check(Schema.isPattern(/^[{}|$:@#/.=*\\ \n‎abxyz019-]*$/));

describe("fuzzing", () => {
  it.prop("never throws on any string", [Schema.String], ([source]) => {
    const result = parseResult(source);
    assert.isTrue(Result.isSuccess(result) || result.failure instanceof MessageFormatError);
  });

  it.prop("never throws on MF2-like strings", [Mf2ish], ([source]) => {
    const result = parseResult(source);
    if (Result.isSuccess(result)) {
      assert.isTrue(Schema.is(DataModel.Message)(result.success));
    } else {
      assert.instanceOf(result.failure, MessageFormatError);
    }
  });
});
