import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { expectTypeOf } from "vite-plus/test";
import { isMessage, make, Message, type Params, type ParamSchemas } from "./Message";

describe("make", () => {
  it("infers params from the pattern", () => {
    const greeting = make("Hello, {$name}! You have {$count :integer} items.");
    expectTypeOf<Params<typeof greeting>>().toEqualTypeOf<{
      readonly name: string | number | boolean | bigint;
      readonly count: number;
    }>();
  });

  it("takes explicit params schemas", () => {
    const greeting = make("Hello, {$name}! You have {$count :integer} items.", {
      params: { name: Schema.String, count: Schema.Int },
    });
    expectTypeOf<Params<typeof greeting>>().toEqualTypeOf<{
      readonly name: string;
      readonly count: number;
    }>();
    expectTypeOf<{ readonly count: typeof Schema.String }>().not.toExtend<
      ParamSchemas<"{$count :integer}">
    >();
    expectTypeOf<{ readonly count: typeof Schema.Int }>().not.toExtend<
      ParamSchemas<"{$name} {$count :integer}">
    >();
  });

  it("keeps translator metadata, with defaults", () => {
    const message = make("Checkout", { description: "Cart button", maxLength: 12, tags: ["cart"] });
    assert.isTrue(isMessage(message));
    assert.strictEqual(message.description, "Cart button");
    assert.strictEqual(message.maxLength, 12);
    assert.deepStrictEqual(message.tags, ["cart"]);
    assert.deepStrictEqual(message.screenshots, []);
    assert.isFalse(message.doNotTranslate);
    assert.isFalse(isMessage({ source: "Checkout" }));
  });

  it("rejects a maxLength that isn't a positive integer", () => {
    assert.throws(() => make("x", { maxLength: 0 }));
    assert.throws(() => make("x", { maxLength: 1.5 }));
  });

  it("compares structurally", () => {
    assert.isTrue(Schema.decodeSync(Message)({ source: "a", tags: ["t"] }) instanceof Message);
  });
});
