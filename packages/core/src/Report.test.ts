import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import { assert, describe, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ProjectConfig } from "./Config";
import { ModuleLoader } from "./ModuleLoader";
import { load } from "./Project";
import { Diagnostic, TargetFailed } from "./Diagnostic";
import { github, json, Located, locateAll, offsetIn, positionOf, text } from "./Report";

const root = new URL("compiler/__fixtures__/app/", import.meta.url).pathname;

const layer = Layer.mergeAll(
  ProjectConfig.layerTest({
    sourceLocale: "en",
    locales: ["en", "de", "fr"],
    catalogs: ["src/**/*.messages.ts"],
  }),
  ModuleLoader.layer,
).pipe(Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)));

const located = Effect.fn("located")(function* () {
  const project = yield* load(root);
  return yield* locateAll(project, project.diagnostics, root);
});

const Encoded = Schema.fromJsonString(Schema.String);

describe("Report", () => {
  it.layer(layer)((scoped) => {
    scoped.effect("points a syntax error in a template literal at its column", () =>
      Effect.gen(function* () {
        const all = yield* located();
        const broken = yield* Effect.fromOption(
          Arr.findFirst(all, (l) => l.diagnostic.code === "syntax-error"),
        );
        // `  {$name :string} and {$oops` ends at the closing backtick.
        assert.deepStrictEqual(
          [broken.start?.line, broken.start?.column, broken.excerpt],
          [17, 29, ["  {$name :string} and {$oops`);"]],
        );
      }),
    );

    scoped.effect("renders code frames, JSON and GitHub annotations", (context) =>
      Effect.gen(function* () {
        const all = yield* located();
        context.expect(text(all)).toMatchSnapshot("text");
        context.expect(json(all)).toMatchSnapshot("json");
        context.expect(github(all)).toMatchSnapshot("github");
      }),
    );
  });

  it("escapes what GitHub reads as structure", () => {
    const diagnostic = new Diagnostic({
      severity: "warning",
      reason: new TargetFailed({ target: "web", details: "100% broken,\nbadly" }),
      file: "a:b,c.ts",
    });
    assert.strictEqual(
      github([new Located({ diagnostic, excerpt: [] })]),
      `::warning file=a%3Ab%2Cc.ts,title=target-failed::${diagnostic.message.replaceAll("%", "%25").replaceAll("\n", "%0A")}\n`,
    );
    assert.include(github([new Located({ diagnostic, excerpt: [] })]), "100%25 broken,%0Abadly");
    assert.strictEqual(text([]), "");
  });

  it.prop(
    "finds any offset of a source through its JSON string",
    [Schema.NonEmptyString, Schema.Int],
    ([source, at]) => {
      const offset = Math.abs(at) % (source.length + 1);
      const file = Schema.encodeSync(Encoded)(source);
      const encodedPrefix = Schema.encodeSync(Encoded)(source.slice(0, offset));
      // The opening quote, then the prefix without its quotes.
      assert.deepStrictEqual(offsetIn(file, source, offset), Option.some(encodedPrefix.length - 1));
    },
  );

  it("counts lines and columns from 1", () => {
    assert.deepStrictEqual(
      [positionOf("ab\ncd", 0), positionOf("ab\ncd", 4)].map((p) => [p.line, p.column]),
      [
        [1, 1],
        [2, 2],
      ],
    );
  });
});
