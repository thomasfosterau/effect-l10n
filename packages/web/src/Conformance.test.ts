import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import { assert, describe, it } from "@effect/vitest";
import { parse, parseResult } from "@thomasfosterau/effect-l10n/messageformat/Parser";
import { check } from "@thomasfosterau/effect-l10n/messageformat/Validation";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { load } from "./__fixtures__/harness";
import { compare, reference } from "./__fixtures__/reference";

const Properties = {
  locale: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(
    Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.Unknown })),
  ),
};

const Suite = Schema.fromJsonString(
  Schema.Struct({
    defaultTestProperties: Schema.optionalKey(Schema.Struct(Properties)),
    tests: Schema.Array(Schema.Struct({ src: Schema.String, ...Properties })),
  }),
);

const suites = [
  "syntax.json",
  "bidi.json",
  "fallback.json",
  "pattern-selection.json",
  "u-options.json",
  "functions/currency.json",
  "functions/date.json",
  "functions/datetime.json",
  "functions/integer.json",
  "functions/number.json",
  "functions/offset.json",
  "functions/percent.json",
  "functions/string.json",
  "functions/time.json",
];

const conformance = new URL("../../core/src/messageformat/__conformance__/", import.meta.url)
  .pathname;

interface Case {
  readonly name: string;
  readonly src: string;
  readonly locale: string;
  readonly params: R.ReadonlyRecord<string, unknown>;
}

/** The suite's cases the web target compiles: valid messages with only default functions. */
const readCases = Effect.fn("readCases")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const all = yield* Effect.forEach(
    suites,
    (file) =>
      fs.readFileString(path.join(conformance, file)).pipe(
        Effect.flatMap(Schema.decodeEffect(Suite)),
        Effect.map((suite) =>
          Arr.map(suite.tests, (test): Case => {
            const merged = { ...suite.defaultTestProperties, ...test };
            return {
              name: `${file}: ${test.src}`,
              src: test.src,
              locale: merged.locale ?? "en-US",
              params: R.fromEntries(
                Arr.map(merged.params ?? [], ({ name, value }) => [name, value]),
              ),
            };
          }),
        ),
      ),
    { concurrency: 4 },
  );
  return Arr.filter(Arr.flatten(all), (c) =>
    Result.match(parseResult(c.src), {
      onFailure: () => false,
      onSuccess: (message) =>
        !c.src.includes(":test:") && !Arr.some(check(message), (d) => d.severity === "error"),
    }),
  );
});

const bidiStrategies: ReadonlyArray<"default" | "none"> = ["default", "none"];

describe("the web target against the reference formatter", () => {
  it.layer(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, reference))((scoped) => {
    scoped.effect("formats the conformance suite's messages as the reference does", () =>
      Effect.gen(function* () {
        const cases = yield* readCases();
        assert.isAbove(cases.length, 250);
        const { messages } = yield* load(
          Arr.map(cases, (c, i) => ({ id: `m${i}`, locales: { [c.locale]: c.src } })),
        );
        const mismatches = yield* Effect.forEach(
          cases,
          (c, i) =>
            Effect.gen(function* () {
              const message = yield* parse(c.src);
              const compiled = yield* Effect.fromOption(R.get(messages, `m${i}`));
              const found = yield* Effect.forEach(
                bidiStrategies,
                (bidi) => compare(message, compiled, c.locale, c.params, bidi),
                { concurrency: 1 },
              );
              return Arr.map(Arr.getSomes(found), (m) => ({ name: c.name, ...m }));
            }),
          { concurrency: 1 },
        );
        assert.deepStrictEqual(Arr.flatten(mismatches), []);
      }),
    );
  });
});
