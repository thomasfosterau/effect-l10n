import { assert, describe, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import { check, entries, identifierOf, make as catalog } from "./Catalog";
import { make } from "./Message";

const greeting = make("Hello");

describe("entries", () => {
  it("derives IDs from export paths, with namespaces and overrides", () => {
    const found = entries(
      {
        greeting,
        checkout: catalog({ total: make("Total"), tax: { rate: make("Rate") } }),
        renamed: make("Kept", { id: "legacy.title" }),
        helper: () => "not a message",
        list: [make("in an array")],
      },
      Option.some("app.messages.ts"),
    );
    assert.deepStrictEqual(
      Arr.map(found, (entry) => entry.id),
      ["greeting", "checkout.total", "checkout.tax.rate", "legacy.title"],
    );
    assert.deepStrictEqual(found[0]?.file, Option.some("app.messages.ts"));
  });

  it("reads a default export as the module root", () => {
    assert.deepStrictEqual(
      Arr.map(entries({ default: catalog({ greeting }) }), (entry) => entry.id),
      ["greeting"],
    );
  });
});

describe("identifierOf", () => {
  it("mangles per platform", () => {
    assert.strictEqual(identifierOf("checkout.totalPrice", "android"), "checkout_total_price");
    assert.strictEqual(identifierOf("checkout.total_price", "swift"), "checkout.totalPrice");
    assert.strictEqual(identifierOf("checkout.totalPrice", "kotlin"), "checkout.totalPrice");
  });
});

const entry = (id: string, file = "a.ts") => ({ id, message: greeting, file: Option.some(file) });

describe("check", () => {
  it("reports invalid, duplicate and colliding IDs", () => {
    const codes = Arr.map(
      check([
        entry("ok.id"),
        entry("1bad"),
        entry("has-dash"),
        entry("dup", "a.ts"),
        entry("dup", "b.ts"),
        entry("fooBar"),
        entry("foo_bar"),
      ]),
      (diagnostic) => [diagnostic.code, diagnostic.messageId ?? ""],
    );
    assert.deepStrictEqual(codes, [
      ["invalid-message-id", "1bad"],
      ["invalid-message-id", "has-dash"],
      ["duplicate-message-id", "dup"],
      ["message-id-collision", ""],
      ["message-id-collision", ""],
      ["message-id-collision", ""],
    ]);
  });

  it("drops findings turned off", () => {
    assert.deepStrictEqual(check([entry("1bad")], { "invalid-message-id": "off" }), []);
  });

  it("keeps the files of a duplicate", () => {
    const [duplicate] = check([entry("dup", "a.ts"), entry("dup", "b.ts")]);
    assert.isTrue(duplicate !== undefined && duplicate.reason._tag === "DuplicateMessageId");
  });
});
