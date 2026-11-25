/**
 * The compiler: lowers a loaded project for each of the config's targets,
 * runs the targets side by side, and writes their files. Writes are
 * incremental: only changed files are written, and files a target no
 * longer emits are removed.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as HashMap from "effect/HashMap";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Path from "effect/Path";
import * as R from "effect/Record";
import * as Ref from "effect/Ref";
import type * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as Stream from "effect/Stream";
import { ConfigError, ProjectConfig, type Target as ConfigTarget } from "../Config";
import {
  Diagnostic,
  report,
  Severities,
  type Severity,
  TargetFailed,
  UnknownTarget,
} from "../Diagnostic";
import { ModuleLoader, ModuleLoadError } from "../ModuleLoader";
import { load, Project, TranslationFileError } from "../Project";
import * as Report from "../Report";
import * as Ir from "./Ir";
import * as Lowering from "./Lowering";
import { type FileTree, isTarget, type Target } from "./Target";

/**
 * A file couldn't be written or removed.
 *
 * @category errors
 * @since 0.1.0
 */
export class OutputError extends Schema.TaggedError<
  OutputError,
  { readonly brand: unique symbol }
>()("OutputError", { file: Schema.String, details: Schema.String }) {
  /** effect-l10n's name for this error. */
  readonly code = "output-error";
  override get message(): string {
    return `${this.file}: ${this.details}`;
  }
}

/**
 * A build failed: the project didn't load, or its output couldn't be
 * written. Findings about messages are diagnostics, not this.
 *
 * @category errors
 * @since 0.1.0
 */
export class CompileError extends Schema.TaggedError<
  CompileError,
  { readonly brand: unique symbol }
>()("CompileError", {
  reason: Schema.Union([ConfigError, ModuleLoadError, TranslationFileError, OutputError]),
}) {
  override get message(): string {
    return this.reason.message;
  }
}

const files = Schema.Array(Schema.String);

/**
 * One target's output: its files, relative to `directory` (itself relative
 * to the root), its findings, and, after a build, which files were written
 * and removed.
 *
 * @category models
 * @since 0.1.0
 */
export class TargetResult extends Schema.Class<TargetResult, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/compiler/TargetResult",
)({
  target: Schema.String,
  directory: Schema.String,
  files: Schema.Record(Schema.String, Schema.String),
  diagnostics: Schema.Array(Diagnostic),
  /** Whether the target emitted; a failed one's previous files are kept. */
  emitted: Schema.Boolean,
  written: files,
  removed: files,
}) {}

/**
 * A build's result: the project's findings and each target's output.
 *
 * @category models
 * @since 0.1.0
 */
export class BuildResult extends Schema.Class<BuildResult, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/compiler/BuildResult",
)({
  /** The project that was compiled. */
  project: Project,
  targets: Schema.Array(TargetResult),
}) {
  /** The project's findings. */
  get diagnostics(): ReadonlyArray<Diagnostic> {
    return this.project.diagnostics;
  }
  /** Every finding: the project's, then each target's. */
  get all(): ReadonlyArray<Diagnostic> {
    return [...this.diagnostics, ...Arr.flatMap(this.targets, (t) => t.diagnostics)];
  }
  /** Whether no finding is an error. */
  get ok(): boolean {
    return !Arr.some(this.all, (d) => d.severity === "error");
  }
}

/**
 * The compiler service. Its dependencies are resolved when its layer is
 * built, so none of its operations need services.
 *
 * - `compile`: a loaded project's output, without writing it.
 * - `build`: loads the project, compiles it, and writes the output.
 * - `watch`: builds, then builds again each time a file under the root
 *   changes (debounced), ignoring the output directory. It runs until
 *   interrupted; a failed build is a failed `Result`, and the next change
 *   builds again.
 * - `locate`: a build's findings, placed in their files for the renderers
 *   of `Report`.
 *
 * @category services
 * @since 0.1.0
 */
export class Compiler extends Context.Service<
  Compiler,
  {
    readonly compile: (project: Project) => Effect.Effect<BuildResult>;
    readonly build: Effect.Effect<BuildResult, CompileError>;
    readonly watch: Stream.Stream<Result.Result<BuildResult, CompileError>>;
    readonly locate: (result: BuildResult) => Effect.Effect<ReadonlyArray<Report.Located>>;
  }
>()("@thomasfosterau/effect-l10n/compiler/Compiler") {
  /**
   * The compiler for the project whose catalogs and translations are
   * relative to `root`. `debounce` is how long watch mode waits after a
   * change, 100 milliseconds by default.
   */
  static readonly layer = (
    options: { readonly root?: string; readonly debounce?: Duration.Input } = {},
  ): Layer.Layer<
    Compiler,
    never,
    ProjectConfig | ModuleLoader | FileSystem.FileSystem | Path.Path
  > => Layer.effect(Compiler, make(options));
}

/** Where a manifest of a target's files lives, inside its directory. */
const manifestFile = ".effect-l10n-manifest.json";

const Manifest = Schema.fromJsonString(files);

const formatter = SchemaIssue.makeFormatterDefault();

type Overrides = R.ReadonlyRecord<string, Severity>;

type Lowered = readonly [Lowering.Message, ReadonlyArray<Diagnostic>];

/** What a lowered message depends on: the capabilities and the IR message. */
const CacheKey = Schema.fromJsonString(
  Schema.toCodecJson(Schema.Tuple([Lowering.Capabilities, Ir.Message])),
);

const outputError = (file: string) => (error: { readonly message: string }) =>
  new CompileError({ reason: new OutputError({ file, details: error.message }) });

const make = Effect.fnUntraced(function* (options: {
  readonly root?: string;
  readonly debounce?: Duration.Input;
}) {
  const config = yield* ProjectConfig;
  const loader = yield* ModuleLoader;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const severities = yield* Severities;
  const root = path.resolve(options.root ?? ".");
  const overrides: Overrides = { ...severities, ...config.severities };
  // Each target's lowered messages by what they depend on, kept from one
  // build to the next; a build keeps only the entries it used.
  const cache = yield* Ref.make(HashMap.empty<string, HashMap.HashMap<string, Lowered>>());

  const lowerAll = (ir: Ir.Project, target: Target) =>
    Ref.modify(cache, (targets) => {
      const previous = Option.getOrElse(HashMap.get(targets, target.name), () =>
        HashMap.empty<string, Lowered>(),
      );
      const entries = Arr.map(ir.messages, (message): readonly [string, Lowered] => {
        const key = Schema.encodeSync(CacheKey)([target.capabilities, message]);
        return [
          key,
          Option.getOrElse(HashMap.get(previous, key), () =>
            Lowering.lowerMessage(message, target, overrides),
          ),
        ];
      });
      return [
        Arr.map(entries, ([, lowered]) => lowered),
        HashMap.set(targets, target.name, HashMap.fromIterable(entries)),
      ] as const;
    });

  const runTarget = (ir: Ir.Project, entry: ConfigTarget): Effect.Effect<TargetResult> => {
    const directory = path.join(config.outDir, entry.target);
    const result = (fields: { files?: FileTree; diagnostics: ReadonlyArray<Diagnostic> }) =>
      new TargetResult({
        target: entry.target,
        directory,
        files: fields.files ?? {},
        diagnostics: fields.diagnostics,
        emitted: fields.files !== undefined,
        written: [],
        removed: [],
      });
    const failed = (reason: TargetFailed | UnknownTarget) =>
      result({ diagnostics: Option.toArray(report(overrides, "error", reason)) });
    const plugin = entry.plugin;
    if (!isTarget(plugin)) {
      return Effect.succeed(failed(new UnknownTarget({ target: entry.target })));
    }
    return Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(plugin.options)(entry.options).pipe(
        Effect.mapError((error) => formatter(error.issue)),
      );
      const lowered = yield* lowerAll(ir, plugin);
      const project = Lowering.project(
        ir,
        plugin.name,
        Arr.map(lowered, ([m]) => m),
      );
      const emitted = yield* plugin
        .emit(project, decoded)
        .pipe(Effect.mapError((error) => error.details));
      return result({ files: emitted, diagnostics: Arr.flatMap(lowered, ([, d]) => d) });
    }).pipe(
      Effect.match({
        onFailure: (details) => failed(new TargetFailed({ target: entry.target, details })),
        onSuccess: (done) => done,
      }),
    );
  };

  const compile = Effect.fn("Compiler.compile")(function* (project: Project) {
    const ir = Ir.fromProject(project);
    const targets = yield* Effect.forEach(config.targets, (entry) => runTarget(ir, entry), {
      concurrency: "unbounded",
    });
    return new BuildResult({ project, targets });
  });

  const write = Effect.fn("Compiler.write")(function* (target: TargetResult) {
    const directory = path.resolve(root, target.directory);
    const manifestPath = path.join(directory, manifestFile);
    const previous = (yield* fs.exists(manifestPath).pipe(Effect.orElseSucceed(() => false)))
      ? yield* fs.readFileString(manifestPath).pipe(
          Effect.flatMap(Schema.decodeEffect(Manifest)),
          Effect.orElseSucceed((): ReadonlyArray<string> => []),
        )
      : [];
    const current = Arr.sort(R.keys(target.files), Order.String);
    const written = yield* Effect.filter(
      current,
      (file) => {
        const full = path.resolve(directory, file);
        const contents = target.files[file] ?? "";
        if (!full.startsWith(`${directory}${path.sep}`)) {
          return Effect.fail(outputError(file)({ message: "is outside the target's directory" }));
        }
        return fs.readFileString(full).pipe(
          Effect.option,
          Effect.flatMap((existing) =>
            Option.contains(existing, contents)
              ? Effect.succeed(false)
              : fs
                  .makeDirectory(path.dirname(full), { recursive: true })
                  .pipe(Effect.andThen(fs.writeFileString(full, contents)), Effect.as(true)),
          ),
          Effect.mapError(outputError(file)),
        );
      },
      { concurrency: 8 },
    );
    const removed = Arr.filter(previous, (file) => !Arr.contains(current, file));
    yield* Effect.forEach(
      removed,
      (file) =>
        fs
          .remove(path.resolve(directory, file), { force: true })
          .pipe(Effect.mapError(outputError(file))),
      { concurrency: 8, discard: true },
    );
    const manifest = yield* Schema.encodeEffect(Manifest)(current).pipe(
      Effect.mapError(outputError(manifestFile)),
    );
    if (
      !Arr.isArrayEmpty(written) ||
      !Arr.isArrayEmpty(removed) ||
      previous.length !== current.length
    ) {
      yield* fs
        .makeDirectory(directory, { recursive: true })
        .pipe(
          Effect.andThen(fs.writeFileString(manifestPath, `${manifest}\n`)),
          Effect.mapError(outputError(manifestFile)),
        );
    }
    return new TargetResult({
      target: target.target,
      directory: target.directory,
      files: target.files,
      diagnostics: target.diagnostics,
      emitted: target.emitted,
      written,
      removed,
    });
  });

  const build = Effect.gen(function* () {
    const project = yield* load(root).pipe(
      Effect.provideService(ProjectConfig, config),
      Effect.provideService(ModuleLoader, loader),
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError((reason) => new CompileError({ reason })),
    );
    const result = yield* compile(project);
    const targets = yield* Effect.forEach(
      result.targets,
      (target) => (target.emitted ? write(target) : Effect.succeed(target)),
      { concurrency: 1 },
    );
    return new BuildResult({ project: result.project, targets });
  }).pipe(Effect.withSpan("Compiler.build"));

  const output = path.resolve(root, config.outDir);
  const ignored = (file: string) => {
    const full = path.resolve(root, file);
    return (
      full === output ||
      full.startsWith(`${output}${path.sep}`) ||
      full.includes(`${path.sep}node_modules${path.sep}`)
    );
  };
  const watch: Stream.Stream<Result.Result<BuildResult, CompileError>> = Stream.concat(
    Stream.make(undefined),
    fs.watch(root, { recursive: true }).pipe(
      Stream.filter((event) => !ignored(event.path)),
      Stream.debounce(options.debounce ?? Duration.millis(100)),
      Stream.map(() => undefined),
      Stream.catch(() => Stream.empty),
    ),
  ).pipe(Stream.mapEffect(() => Effect.result(build)));

  const locate = (result: BuildResult) =>
    Report.locateAll(result.project, result.all, root).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );

  return { compile, build, watch, locate };
});
