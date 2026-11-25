/**
 * The compiler on Node: a layer that reads `effect-l10n.config.ts` and the
 * project's files from disk, and `compile`, a Promise API for scripts that
 * don't use Effect. This is the only module that runs an Effect runtime.
 *
 * @since 0.1.0
 */
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import { type ConfigError, ProjectConfig } from "@thomasfosterau/effect-l10n/Config";
import { ModuleLoader } from "@thomasfosterau/effect-l10n/ModuleLoader";
import * as Report from "@thomasfosterau/effect-l10n/Report";
import { type BuildResult, Compiler } from "@thomasfosterau/effect-l10n/compiler/Compiler";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Path from "effect/Path";

/**
 * Where the project is and how to compile it.
 *
 * - `cwd`: the project root, the current directory by default.
 * - `config`: the config file, `effect-l10n.config.ts` in `cwd` by default.
 * - `outDir`: overrides the config's `outDir`.
 * - `debounce`: how long watch mode waits after a change.
 *
 * @category models
 * @since 0.1.0
 */
export interface Options {
  readonly cwd?: string;
  readonly config?: string;
  readonly outDir?: string;
  readonly debounce?: Duration.Input;
}

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const configLayer = (options: Options) =>
  Layer.unwrap(
    Effect.map(Effect.service(Path.Path), (path) => {
      const cwd = path.resolve(options.cwd ?? ".");
      const file = path.resolve(cwd, options.config ?? "effect-l10n.config.ts");
      const loaded = ProjectConfig.layer(file);
      const { outDir } = options;
      return outDir === undefined
        ? loaded
        : Layer.effect(
            ProjectConfig,
            Effect.map(Effect.service(ProjectConfig), (config) => ({ ...config, outDir })),
          ).pipe(Layer.provide(loaded));
    }),
  );

/**
 * The compiler for the project at `options.cwd`, with its config and files
 * read through Node.
 *
 * @category layers
 * @since 0.1.0
 */
export const layer = (options: Options = {}): Layer.Layer<Compiler, ConfigError> =>
  Compiler.layer(
    options.debounce === undefined
      ? { root: options.cwd ?? "." }
      : { root: options.cwd ?? ".", debounce: options.debounce },
  ).pipe(
    Layer.provide(configLayer(options)),
    Layer.provide(ModuleLoader.layer),
    Layer.provide(platform),
  );

/**
 * What `compile` resolves to: the build, whether it has no errors, and its
 * findings rendered as text.
 *
 * @category models
 * @since 0.1.0
 */
export interface CompileResult {
  readonly ok: boolean;
  readonly result: BuildResult;
  readonly report: string;
}

/**
 * Builds the project once and resolves to its result. It rejects with a
 * `ConfigError` or `CompileError` when the project can't be loaded or its
 * output can't be written; findings, errors among them, are in the result.
 *
 * @category running
 * @since 0.1.0
 */
export const compile = (options: Options = {}): Promise<CompileResult> => {
  const runtime = ManagedRuntime.make(layer(options));
  return runtime
    .runPromise(
      Effect.gen(function* () {
        const compiler = yield* Compiler;
        const result = yield* compiler.build;
        const located = yield* compiler.locate(result);
        return { ok: result.ok, result, report: Report.text(located) };
      }),
    )
    .finally(() => runtime.dispose());
};
