import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import { expectGoldenTree } from "@thomasfosterau/effect-l10n-testing";
import { assert, describe, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { defineTarget, type Input, ProjectConfig } from "../Config";
import { ModuleLoader } from "../ModuleLoader";
import { type BuildResult, Compiler } from "./Compiler";
import { debug } from "./Debug";
import type { Capabilities } from "./Lowering";
import * as Plan from "./Plan";
import { make, TargetError } from "./Target";

const fixture = new URL("__fixtures__/app/", import.meta.url).pathname;

const capabilities: Capabilities = {
  selectors: "plural",
  maxSelectors: 1,
  hasExactKeys: false,
  functions: ["integer", "string"],
  markup: "strip",
  hasAccessors: true,
};

/** One file per message and locale: the locale its text comes from. */
const perMessage = make({
  name: "per-message",
  options: Schema.Struct({}),
  capabilities,
  emit: (project) =>
    Effect.succeed(
      R.fromEntries(
        Arr.flatMap(project.messages, (message) =>
          Arr.map(R.values(message.locales), (l): readonly [string, string] => [
            `${l.locale}/${message.id}.txt`,
            `${l.from} ${Plan.leaves(l.plan).length}\n`,
          ]),
        ),
      ),
    ),
});

const failing = make({
  name: "failing",
  options: Schema.Struct({}),
  capabilities,
  emit: () => Effect.fail(new TargetError({ target: "failing", details: "nothing to emit" })),
});

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

/** A compiler for `root` with `config`, built in the test's scope. */
const compilerFor = (root: string, config: Input<string>, fsLayer = platform) =>
  Layer.build(
    Compiler.layer({ root }).pipe(
      Layer.provide(
        Layer.mergeAll(ProjectConfig.layerTest(config), ModuleLoader.layer).pipe(
          Layer.provideMerge(fsLayer),
        ),
      ),
    ),
  ).pipe(Effect.map(Context.get(Compiler)));

const buildWith = (root: string, config: Input<string>) =>
  Effect.flatMap(compilerFor(root, config), (compiler) => compiler.build);

const targetNamed = (result: BuildResult, name: string) =>
  Effect.fromOption(Arr.findFirst(result.targets, (t) => t.target === name));

const baseConfig = (outDir: string): Input<string> => ({
  sourceLocale: "en",
  locales: ["en", "de", "ar"],
  catalogs: ["src/**/*.messages.ts"],
  outDir,
  targets: [debug({}), perMessage({})],
});

/** A copy of the fixture in a temporary directory, its imports made absolute. */
const copyFixture = Effect.fn("copyFixture")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped();
  const message = new URL("../Message.ts", import.meta.url).pathname;
  yield* fs.makeDirectory(path.join(root, "src"));
  yield* fs.makeDirectory(path.join(root, "translations"));
  yield* Effect.forEach(
    ["src/app.messages.ts", "translations/de.json"],
    (file) =>
      fs
        .readFileString(path.join(fixture, file))
        .pipe(
          Effect.flatMap((text) =>
            fs.writeFileString(path.join(root, file), text.replace("../../../../Message", message)),
          ),
        ),
    { concurrency: 1, discard: true },
  );
  return root;
});

const offerAll = (queue: Queue.Queue<FileSystem.WatchEvent>, paths: ReadonlyArray<string>) =>
  Effect.forEach(paths, (path) => Queue.offer(queue, { _tag: "Update", path }), {
    concurrency: 1,
    discard: true,
  });

describe("Compiler", () => {
  it.layer(platform)((scoped) => {
    scoped.effect("compiles the fixture with the debug target", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const out = yield* fs.makeTempDirectoryScoped();
        const compiler = yield* compilerFor(fixture, { ...baseConfig(out), targets: [debug({})] });
        const result = yield* compiler.build;
        const target = yield* targetNamed(result, "debug");
        const located = yield* compiler.locate(result);
        assert.deepStrictEqual(
          Arr.map(
            Arr.filter(located, (l) => l.diagnostic.code === "syntax-error"),
            (l) => [l.diagnostic.file, l.start?.line, l.start?.column],
          ),
          [["src/app.messages.ts", 17, 29]],
        );
        const golden = yield* path.fromFileUrl(new URL("__golden__/debug", import.meta.url));
        yield* expectGoldenTree(target.files, golden);
      }),
    );

    scoped.effect("writes only what changed, byte for byte, and removes stale files", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* copyFixture();
        const out = path.join(root, "generated");
        const run = buildWith(root, baseConfig("generated"));
        const files = Effect.fnUntraced(function* (result: BuildResult, name: string) {
          const target = yield* targetNamed(result, name);
          return { written: target.written, removed: target.removed };
        });

        const first = yield* run;
        assert.lengthOf((yield* files(first, "per-message")).written, 9);
        const before = yield* fs.readFileString(path.join(out, "debug", "ir.json"));

        const second = yield* run;
        assert.deepStrictEqual(yield* files(second, "per-message"), { written: [], removed: [] });
        assert.deepStrictEqual(yield* files(second, "debug"), { written: [], removed: [] });
        assert.strictEqual(yield* fs.readFileString(path.join(out, "debug", "ir.json")), before);

        // German gains a translation of `invite`: only its German file changes.
        const de = path.join(root, "translations", "de.json");
        const text = yield* fs.readFileString(de);
        yield* fs.writeFileString(
          de,
          text.replace('"greeting"', '"invite": "{$host} hat dich eingeladen",\n    "greeting"'),
        );
        const third = yield* run;
        assert.deepStrictEqual((yield* files(third, "per-message")).written, ["de/invite.txt"]);
        assert.deepStrictEqual((yield* files(third, "debug")).written, ["ir.json"]);

        // Arabic leaves the project: its files go.
        const fourth = yield* buildWith(root, {
          ...baseConfig("generated"),
          locales: ["en", "de"],
        });
        assert.deepStrictEqual((yield* files(fourth, "per-message")).removed, [
          "ar/greeting.txt",
          "ar/invite.txt",
          "ar/items.txt",
        ]);
        assert.isFalse(yield* fs.exists(path.join(out, "per-message", "ar", "items.txt")));
      }),
    );

    scoped.effect("reports a failing or unknown target and still runs the others", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const out = yield* fs.makeTempDirectoryScoped();
        const result = yield* buildWith(fixture, {
          ...baseConfig(out),
          targets: [failing({}), defineTarget("mystery", Schema.Struct({}))({}), perMessage({})],
        });
        assert.deepStrictEqual(
          Arr.map(result.targets, (t) => [
            t.target,
            t.emitted,
            Arr.map(t.diagnostics, (d) => d.code),
          ]),
          [
            ["failing", false, ["target-failed"]],
            ["mystery", false, ["unknown-target"]],
            ["per-message", true, []],
          ],
        );
        assert.isFalse(result.ok);
      }),
    );

    scoped.effect("rebuilds once per burst of changes in watch mode", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const out = yield* fs.makeTempDirectoryScoped();
        const events = yield* Queue.unbounded<FileSystem.WatchEvent>();
        const builds = yield* Queue.unbounded<Result.Result<unknown, unknown>>();
        const watched = Layer.effect(
          FileSystem.FileSystem,
          Effect.map(Effect.service(FileSystem.FileSystem), (real) => ({
            ...real,
            watch: () => Stream.fromQueue(events),
          })),
        ).pipe(Layer.provide(NodeFileSystem.layer), Layer.merge(NodePath.layer));
        const compiler = yield* compilerFor(fixture, baseConfig(out), watched);
        yield* compiler.watch.pipe(
          Stream.runForEach((build) => Queue.offer(builds, build)),
          Effect.forkChild,
        );
        assert.isTrue(Result.isSuccess(yield* Queue.take(builds)));

        yield* offerAll(events, [
          "src/app.messages.ts",
          "translations/de.json",
          "src/app.messages.ts",
          `${out}/debug/ir.json`,
        ]);
        // Let the debounce take the burst, then let its timer fire.
        const settle = TestClock.withLive(Effect.sleep("20 millis"));
        yield* settle;
        yield* TestClock.adjust("50 millis");
        yield* settle;
        assert.strictEqual(yield* Queue.size(builds), 0);
        yield* TestClock.adjust("50 millis");
        assert.isTrue(Result.isSuccess(yield* Queue.take(builds)));

        // A change to the output alone builds nothing.
        yield* offerAll(events, [`${out}/debug/ir.json`]);
        yield* settle;
        yield* TestClock.adjust("1 second");
        yield* settle;
        assert.strictEqual(yield* Queue.size(builds), 0);
      }),
    );
  });
});
