import { assert, describe, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Eq from "effect/Equal";
import * as P from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import bidi from "./__conformance__/bidi.json" with { type: "json" };
import syntax from "./__conformance__/syntax.json" with { type: "json" };
import * as DataModel from "./DataModel";
import { parseResult } from "./Parser";
import { serialize } from "./Serializer";

const Suite = Schema.Struct({ tests: Schema.Array(Schema.Struct({ src: Schema.String })) });

/** Every conformance source that parses. */
const sources = Arr.filter(
  [...Schema.decodeSync(Suite)(syntax).tests, ...Schema.decodeSync(Suite)(bidi).tests].map(
    ({ src }) => src,
  ),
  (src) => Result.isSuccess(parseResult(src)),
);

/** The message `source` parses to, or a description of the failure. */
const parsed = (source: string): DataModel.Message | string =>
  Result.match(parseResult(source), {
    onSuccess: (message) => message,
    onFailure: (error) => `${source} failed: ${error.message}`,
  });

const reparsed = (message: DataModel.Message): DataModel.Message | string =>
  parsed(serialize(message));

// The two things the syntax can't keep: adjacent text parts, which parse as
// one, and a catch-all key's other-syntax name, which MF2 writes as `*`.
const mergeText = (pattern: DataModel.Pattern): DataModel.Pattern =>
  Arr.reduce(pattern, Arr.empty<DataModel.Pattern[number]>(), (parts, part) => {
    const last = parts.at(-1);
    return P.isString(part) && P.isString(last)
      ? [...parts.slice(0, -1), last + part]
      : [...parts, part];
  });

const canonical = (message: DataModel.Message): DataModel.Message =>
  message.type === "message"
    ? new DataModel.PatternMessage({
        declarations: message.declarations,
        pattern: mergeText(message.pattern),
      })
    : new DataModel.SelectMessage({
        declarations: message.declarations,
        selectors: message.selectors,
        variants: Arr.map(
          message.variants,
          (variant) =>
            new DataModel.Variant({
              keys: Arr.map(variant.keys, (key) =>
                key.type === "*" ? new DataModel.CatchallKey({}) : key,
              ),
              value: mergeText(variant.value),
            }),
        ),
      });

describe("conformance", () => {
  it("has sources to round-trip", () => {
    assert.isAbove(sources.length, 100);
  });

  it.each(sources)("%j round-trips", (source) => {
    const message = parsed(source);
    assert.isFalse(P.isString(message), P.isString(message) ? message : source);
    if (P.isString(message)) return;
    const text = serialize(message);
    assert.isTrue(Eq.equals(parsed(text), message), text);
    assert.strictEqual(serialize(canonical(message)), text);
  });
});

describe("canonical syntax", () => {
  it.each([
    ["Hello, {$name}!", "Hello, {$name}!"],
    ["  {{Hi}}  ", "Hi"],
    ["{{ .starts with a dot}}", "{{ .starts with a dot}}"],
    ["\\{\\}\\\\|", "\\{\\}\\\\|"],
    ["{|plain|}{|two words|}{|a\\|b|}{||}{|\\{|}", "{plain}{|two words|}{|a\\|b|}{||}{|{|}"],
    [
      "{$x :number   minimumFractionDigits = 2 @a @b = |c d|}",
      "{$x :number minimumFractionDigits=2 @a @b=|c d|}",
    ],
    ["{:datetime}{#b}x{/b}{#br/}", "{:datetime}{#b}x{/b}{#br /}"],
    [
      ".input {$n :number}.local $x={$n}{{{$x}}}",
      ".input {$n :number}\n.local $x = {$n}\n{{{$x}}}",
    ],
    [
      ".input {$n :number} .match $n 1 {{one}} |*| {{star}} * {{other}}",
      ".input {$n :number}\n.match $n\n1 {{one}}\n|*| {{star}}\n* {{other}}",
    ],
  ])("%j is written %j", (source, expected) => {
    const message = parsed(source);
    assert.isFalse(P.isString(message), P.isString(message) ? message : source);
    if (P.isString(message)) return;
    assert.strictEqual(serialize(message), expected);
  });
});

it.prop("parse(serialize(m)) equals m", [DataModel.Message], ([message]) => {
  assert.isTrue(Eq.equals(reparsed(message), canonical(message)), serialize(message));
});
