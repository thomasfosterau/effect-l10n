import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { compile, type Options } from "./NodeCompiler";

class Rejected extends Schema.TaggedError<Rejected, { readonly brand: unique symbol }>()(
  "Rejected",
  { cause: Schema.Unknown },
) {}

const run = (options: Options) =>
  Effect.tryPromise({ try: () => compile(options), catch: (cause) => new Rejected({ cause }) });

const cwd = new URL("__fixtures__/app/", import.meta.url).pathname;

describe("compile", () => {
  it.layer(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))((scoped) => {
    scoped.effect("builds a project from its config through the Promise API", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const outDir = yield* fs.makeTempDirectoryScoped();
        const { ok, result, report } = yield* run({ cwd, outDir });
        assert.isFalse(ok);
        assert.deepStrictEqual(
          result.targets.map((t) => [t.target, t.written]),
          [["debug", ["ir.json"]]],
        );
        const ir = yield* fs.readFileString(path.join(outDir, "debug", "ir.json"));
        assert.include(ir, '"id": "greeting"');
        assert.include(report, "error[syntax-error]");
        assert.include(report, "--> src/app.messages.ts:5:");
      }),
    );

    scoped.effect("rejects when the config can't be loaded", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(run({ cwd, config: "missing.config.ts" }));
        assert.propertyVal(error.cause, "_tag", "ConfigError");
      }),
    );
  });
});
