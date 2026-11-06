/**
 * Golden-file trees: compare the files a target emits for a fixture project
 * with a directory of committed snapshots.
 *
 * @since 0.1.0
 */
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { expect } from "vite-plus/test";

/**
 * An emitted file tree: POSIX-style paths relative to the output root, each
 * mapped to the file's full text.
 *
 * @since 0.1.0
 * @category models
 */
export type FileTree = Readonly<Record<string, string>>;

/**
 * The Node `FileSystem` and `Path` services {@link expectGoldenTree} needs.
 *
 * @since 0.1.0
 * @category layers
 */
export const layer: Layer.Layer<FileSystem.FileSystem | Path.Path> = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
);

/**
 * An emitted file differs from its committed snapshot (or has none): the
 * rejection of Vitest's `toMatchFileSnapshot`, with its diff as the cause.
 *
 * @since 0.1.0
 * @category errors
 */
export class GoldenFileMismatch extends Schema.TaggedError<
  GoldenFileMismatch,
  { readonly brand: unique symbol }
>()("GoldenFileMismatch", { file: Schema.String, cause: Schema.Defect() }) {}

/**
 * Asserts that `tree` matches the snapshots under `directory`, one committed
 * file per emitted file, through Vitest's `toMatchFileSnapshot`. A missing or
 * changed snapshot fails the test; `vp test run -u` writes the emitted tree
 * over the snapshots instead. A committed file the tree no longer emits fails
 * the test until it is deleted, so the directory is always exactly the
 * target's output.
 *
 * @since 0.1.0
 * @category assertions
 */
export const expectGoldenTree = Effect.fn("expectGoldenTree")(function* (
  tree: FileTree,
  directory: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const emitted = Arr.sort(R.keys(tree), Str.Order);
  yield* Effect.forEach(
    emitted,
    (file) =>
      // A mismatch rejects with Vitest's diff, which fails the test.
      Effect.tryPromise({
        try: () => expect(tree[file], file).toMatchFileSnapshot(path.join(directory, file)),
        catch: (cause) => new GoldenFileMismatch({ file, cause }),
      }),
    // One at a time: Vitest's snapshot state is not built for interleaved writes.
    { concurrency: 1, discard: true },
  );
  // Vitest writes new snapshots when the test ends, so on the run that
  // creates the tree the directory does not exist yet: nothing is stale.
  const entries = (yield* fs.exists(directory))
    ? yield* fs.readDirectory(directory, { recursive: true })
    : [];
  const files = yield* Effect.filter(entries, (entry) =>
    Effect.map(fs.stat(path.join(directory, entry)), (info) => info.type === "File"),
  );
  const stale = Arr.sort(
    Arr.filter(
      Arr.map(files, (file) => Arr.join(Str.split(file, path.sep), "/")),
      (file) => !R.has(tree, file),
    ),
    Str.Order,
  );
  expect(stale, `stale golden files in ${directory}: delete them`).toStrictEqual([]);
});
