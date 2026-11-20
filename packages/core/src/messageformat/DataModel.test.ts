import { assert, describe, it } from "@effect/vitest";
import * as Eq from "effect/Equal";
import * as Hash from "effect/Hash";
import * as Match from "effect/Match";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as DataModel from "./DataModel";

const decode = Schema.decodeUnknownSync(DataModel.MessageJson);
const decodeResult = Schema.decodeUnknownResult(DataModel.MessageJson);
const encode = Schema.encodeSync(DataModel.MessageJson);

// The spec's JSON form of `.input {$count :number} .local $x = {|1| :integer
// @a=|b| @c} .match $count one {{{#b}You have {$count}{/b} {$x}}} * {{{:x}}}`,
// written out in full.
const selectJson = {
  type: "select",
  declarations: [
    {
      type: "input",
      name: "count",
      value: {
        type: "expression",
        arg: { type: "variable", name: "count" },
        function: { type: "function", name: "number", options: {} },
        attributes: {},
      },
    },
    {
      type: "local",
      name: "x",
      value: {
        type: "expression",
        arg: { type: "literal", value: "1" },
        function: {
          type: "function",
          name: "integer",
          options: { minimumIntegerDigits: { type: "literal", value: "2" } },
        },
        attributes: { a: { type: "literal", value: "b" }, c: true },
      },
    },
  ],
  selectors: [{ type: "variable", name: "count" }],
  variants: [
    {
      keys: [{ type: "literal", value: "one" }],
      value: [
        { type: "markup", kind: "open", name: "b", options: {}, attributes: {} },
        "You have ",
        { type: "expression", arg: { type: "variable", name: "count" }, attributes: {} },
        { type: "markup", kind: "close", name: "b", options: {}, attributes: {} },
        " ",
        { type: "expression", arg: { type: "variable", name: "x" }, attributes: {} },
      ],
    },
    {
      keys: [{ type: "*" }],
      value: [
        {
          type: "expression",
          function: { type: "function", name: "ns:x", options: {} },
          attributes: {},
        },
      ],
    },
  ],
};

describe("the spec's JSON data model", () => {
  it("round-trips a select message with every node type", () => {
    const message = decode(selectJson);
    assert.instanceOf(message, DataModel.SelectMessage);
    assert.deepStrictEqual(encode(message), selectJson);
  });

  it("round-trips a pattern message", () => {
    const json = { type: "message", declarations: [], pattern: ["Hello, world!"] };
    assert.deepStrictEqual(encode(decode(json)), json);
  });

  it("fills in the keys the JSON Schema lets you leave out", () => {
    const message = decode({
      type: "message",
      pattern: [{ type: "expression", function: { type: "function", name: "datetime" } }],
    });
    assert.deepStrictEqual(encode(message), {
      type: "message",
      declarations: [],
      pattern: [
        {
          type: "expression",
          function: { type: "function", name: "datetime", options: {} },
          attributes: {},
        },
      ],
    });
  });

  it("keeps a catch-all key's value and a node's span", () => {
    const json = {
      type: "select",
      declarations: [],
      selectors: [{ type: "variable", name: "n", span: { start: 7, end: 9 } }],
      variants: [{ keys: [{ type: "*", value: "other" }], value: [] }],
    };
    assert.deepStrictEqual(encode(decode(json)), json);
  });

  it("tells the three expression shapes apart by their operand", () => {
    const message = decode({
      type: "message",
      pattern: [
        { type: "expression", arg: { type: "literal", value: "a" } },
        { type: "expression", arg: { type: "variable", name: "b" } },
        { type: "expression", function: { type: "function", name: "c" } },
      ],
    });
    assert.instanceOf(message, DataModel.PatternMessage);
    assert.deepStrictEqual(
      message.pattern.map((part) => part.constructor),
      [DataModel.LiteralExpression, DataModel.VariableExpression, DataModel.FunctionExpression],
    );
  });

  it.each([
    [
      "an input declaration named after another variable",
      {
        type: "message",
        declarations: [
          {
            type: "input",
            name: "a",
            value: { type: "expression", arg: { type: "variable", name: "b" } },
          },
        ],
        pattern: [],
      },
    ],
    [
      "an input declaration of a literal",
      {
        type: "message",
        declarations: [
          {
            type: "input",
            name: "a",
            value: { type: "expression", arg: { type: "literal", value: "a" } },
          },
        ],
        pattern: [],
      },
    ],
    [
      "an expression with no operand or function",
      { type: "message", pattern: [{ type: "expression" }] },
    ],
    ["empty text", { type: "message", pattern: [""] }],
    ["text with U+0000", { type: "message", pattern: ["a\u0000"] }],
    [
      "a variable name that isn't a name",
      { type: "message", pattern: [{ type: "expression", arg: { type: "variable", name: "1x" } }] },
    ],
    [
      "a namespaced variable name",
      {
        type: "message",
        pattern: [{ type: "expression", arg: { type: "variable", name: "a:b" } }],
      },
    ],
    [
      "an unknown markup kind",
      { type: "message", pattern: [{ type: "markup", kind: "self", name: "b" }] },
    ],
    ["an unknown message type", { type: "messages", pattern: [] }],
  ])("rejects %s", (_, json) => {
    assert.isTrue(Result.isFailure(decodeResult(json)));
  });
});

describe("names and identifiers", () => {
  it.each(["a", "_x", "+1", "a-b.c", "é", "日本", "😀"])("%s is a name", (name) => {
    assert.isTrue(Schema.is(DataModel.Name)(name));
  });

  it.each(["", "1a", "-a", ".a", "a b", "a:b", "‎a", "a　"])("%j is not a name", (name) => {
    assert.isFalse(Schema.is(DataModel.Name)(name));
  });

  it("an identifier may have one namespace", () => {
    assert.isTrue(Schema.is(DataModel.Identifier)("u:dir"));
    assert.isFalse(Schema.is(DataModel.Identifier)("a:b:c"));
    assert.isFalse(Schema.is(DataModel.Identifier)(":a"));
  });
});

const at = (start: number, end: number) => new DataModel.Span({ start, end });

// One message as if parsed at `offset` in a larger source.
const parsedAt = (offset: number) =>
  new DataModel.PatternMessage({
    span: at(offset, offset + 4),
    pattern: [
      "Hi ",
      new DataModel.VariableExpression({
        arg: new DataModel.VariableRef({ name: "x", span: at(offset + 1, offset + 3) }),
      }),
    ],
  });

describe("equality", () => {
  it("ignores spans", () => {
    const a = new DataModel.VariableRef({ name: "x", span: at(0, 2) });
    const b = new DataModel.VariableRef({ name: "x", span: at(5, 7) });
    const c = new DataModel.VariableRef({ name: "x" });
    assert.isTrue(Eq.equals(a, b));
    assert.isTrue(Eq.equals(a, c));
    assert.strictEqual(Hash.hash(a), Hash.hash(c));
  });

  it("ignores spans all the way down", () => {
    assert.isTrue(Eq.equals(parsedAt(0), parsedAt(10)));
    assert.strictEqual(Hash.hash(parsedAt(0)), Hash.hash(parsedAt(10)));
  });

  it("compares everything else", () => {
    assert.isFalse(
      Eq.equals(new DataModel.VariableRef({ name: "x" }), new DataModel.VariableRef({ name: "y" })),
    );
    assert.isFalse(
      Eq.equals(new DataModel.Literal({ value: "x" }), new DataModel.CatchallKey({ value: "x" })),
    );
    assert.isFalse(
      Eq.equals(
        new DataModel.FunctionRef({ name: "number" }),
        new DataModel.FunctionRef({
          name: "number",
          options: { style: new DataModel.Literal({ value: "percent" }) },
        }),
      ),
    );
  });
});

it("an input declaration's name is its variable's", () => {
  const declaration = new DataModel.InputDeclaration({
    value: new DataModel.VariableExpression({ arg: new DataModel.VariableRef({ name: "n" }) }),
  });
  assert.strictEqual(declaration.name, "n");
});

it("matches nodes by type", () => {
  const describeKey = Match.type<DataModel.Key>().pipe(
    Match.discriminatorsExhaustive("type")({ literal: (key) => `|${key.value}|`, "*": () => "*" }),
  );
  assert.deepStrictEqual(
    [new DataModel.Literal({ value: "one" }), new DataModel.CatchallKey({})].map(describeKey),
    ["|one|", "*"],
  );
  assert.isTrue(DataModel.Message.guards.select(decode(selectJson)));
});

// Every model the schema can generate survives a trip through JSON text.
const MessageText = Schema.fromJsonString(DataModel.MessageJson);

it.prop("round-trips through JSON text", [DataModel.Message], ([message]) => {
  const text = Schema.encodeSync(MessageText)(message);
  const decoded = Schema.decodeSync(MessageText)(text);
  assert.isTrue(Eq.equals(decoded, message));
  assert.strictEqual(Schema.encodeSync(MessageText)(decoded), text);
});
