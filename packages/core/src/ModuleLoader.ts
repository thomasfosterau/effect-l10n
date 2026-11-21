/**
 * Loads TypeScript modules (the config and catalogs) at build time. The
 * default layer uses the runtime's own `import()`, so it needs a runtime
 * that runs TypeScript: Node 22.18 or later, Bun, Deno, or Vite's module
 * runner.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as P from "effect/Predicate";
import type * as R from "effect/Record";
import * as Schema from "effect/Schema";

/**
 * A module failed to load or evaluate. `line` and `column` point into it
 * when the runtime said where.
 *
 * @category errors
 * @since 0.1.0
 */
export class ModuleLoadError extends Schema.TaggedError<
  ModuleLoadError,
  { readonly brand: unique symbol }
>()("ModuleLoadError", {
  file: Schema.String,
  details: Schema.String,
  line: Schema.optionalKey(Schema.Int),
  column: Schema.optionalKey(Schema.Int),
}) {
  /** effect-l10n's name for this error. */
  readonly code = "module-load-error";
  override get message(): string {
    const at = this.line === undefined ? "" : `:${this.line}:${this.column ?? 0}`;
    return `${this.file}${at}: ${this.details}`;
  }
}

/**
 * A module's exports, by name.
 *
 * @category models
 * @since 0.1.0
 */
export type Exports = R.ReadonlyRecord<string, unknown>;

/**
 * The module loader service.
 *
 * @category services
 * @since 0.1.0
 */
export class ModuleLoader extends Context.Service<
  ModuleLoader,
  { readonly load: (file: string) => Effect.Effect<Exports, ModuleLoadError> }
>()("@thomasfosterau/effect-l10n/ModuleLoader") {
  /** Loads with the runtime's `import()`, resolving paths with `Path`. */
  static readonly layer: Layer.Layer<ModuleLoader, never, Path.Path> = Layer.effect(
    ModuleLoader,
    Effect.gen(function* () {
      const path = yield* Path.Path;
      return {
        load: (file) =>
          path.toFileUrl(path.resolve(file)).pipe(
            Effect.mapError((error) => new ModuleLoadError({ file, details: error.message })),
            Effect.flatMap((url) =>
              Effect.tryPromise({
                try: (): Promise<Exports> => import(/* @vite-ignore */ url.href),
                catch: (cause) =>
                  P.hasProperty(cause, "message") && P.isString(cause.message)
                    ? loadError(
                        file,
                        cause.message,
                        P.hasProperty(cause, "stack") && P.isString(cause.stack) ? cause.stack : "",
                      )
                    : loadError(file, String(cause), ""),
              }),
            ),
          ),
      };
    }),
  );
}

/** The runtime's error, with the position it gives in `file` if any. */
const loadError = (file: string, details: string, stack: string): ModuleLoadError => {
  const position = Option.flatMap(
    Arr.findFirst(stack.split("\n"), (line) => line.includes(file)),
    (line) => Option.fromNullishOr(/:(\d+):(\d+)\)?$/.exec(line)),
  );
  return Option.match(position, {
    onNone: () => new ModuleLoadError({ file, details }),
    onSome: ([, line, column]) =>
      new ModuleLoadError({ file, details, line: Number(line), column: Number(column) }),
  });
};
