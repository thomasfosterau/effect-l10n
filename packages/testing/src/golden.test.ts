import { assert, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Order from "effect/Order";
import * as Path from "effect/Path";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { expectGoldenTree, layer, type FileTree } from "./golden";

/** One locale's messages, by message ID. */
const Messages = Schema.Record(Schema.String, Schema.String);
type Messages = typeof Messages.Type;

/** The stub target's file format: the messages as JSON, sorted by ID. */
const MessagesFile = Schema.fromJsonString(Messages, { space: 2 });

const byId = Order.mapInput(Str.Order, ([id]: readonly [string, string]) => id);

/**
 * A stand-in for a real target (M3's `Target` interface, #32): one
 * `<locale>/messages.json` per locale, its messages sorted by ID so the
 * output is deterministic.
 */
const stubTarget = (catalog: Readonly<Record<string, Messages>>): FileTree =>
  R.fromEntries(
    Arr.map(R.toEntries(catalog), ([locale, messages]) => [
      `${locale}/messages.json`,
      `${Schema.encodeSync(MessagesFile)(R.fromEntries(Arr.sort(R.toEntries(messages), byId)))}\n`,
    ]),
  );

/** The fixture project shared by the golden test below. */
const fixture = {
  en: { greeting: "Hello, {$name}!", "cart.items": "{$count :integer} items" },
  fr: { greeting: "Bonjour, {$name} !", "cart.items": "{$count :integer} articles" },
};

it.layer(layer)("golden-file trees", (withFiles) => {
  withFiles.effect("the stub target's output matches the committed tree", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const directory = yield* path.fromFileUrl(new URL("__golden__/stub-target", import.meta.url));
      yield* expectGoldenTree(stubTarget(fixture), directory);
    }),
  );
});

// The property-test pattern the MF2 parser's round-trip tests follow (M1):
// whatever a target emits for a locale reads back as the same messages.
it.prop("the stub target's files round-trip", [Messages], ([messages]) => {
  const file = stubTarget({ en: messages })["en/messages.json"];
  assert.isDefined(file);
  assert.deepStrictEqual(Schema.decodeSync(MessagesFile)(file), messages);
});
