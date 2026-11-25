/**
 * The target plugin interface: a target names itself, decodes its options,
 * declares its capabilities, and emits files from a project lowered for it.
 * `make` turns one into the function a config lists it with.
 *
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect";
import * as P from "effect/Predicate";
import type * as R from "effect/Record";
import * as Schema from "effect/Schema";
import type { OptionsSchema, Target as ConfigTarget } from "../Config";
import type * as Lowering from "./Lowering";

/**
 * Emitted files: POSIX paths relative to the target's output directory,
 * each mapped to its full text.
 *
 * @category models
 * @since 0.1.0
 */
export type FileTree = R.ReadonlyRecord<string, string>;

/**
 * A target failed to emit. The compiler reports it as `target-failed` and
 * runs the other targets anyway.
 *
 * @category errors
 * @since 0.1.0
 */
export class TargetError extends Schema.TaggedError<
  TargetError,
  { readonly brand: unique symbol }
>()("TargetError", { target: Schema.String, details: Schema.String }) {
  /** effect-l10n's name for this error. */
  readonly code = "target-error";
  override get message(): string {
    return `${this.target}: ${this.details}`;
  }
}

/**
 * A target.
 *
 * - `name`: its name in the config and its output directory.
 * - `options`: the schema its options decode with.
 * - `capabilities`: what its resources express, which lowering reads.
 * - `emit`: its files for a lowered project. It must be deterministic: the
 *   same project gives byte-identical files.
 *
 * @category models
 * @since 0.1.0
 */
export interface Target<S extends OptionsSchema = OptionsSchema> {
  readonly name: string;
  readonly options: S;
  readonly capabilities: Lowering.Capabilities;
  readonly emit: (
    project: Lowering.Project,
    options: S["Type"],
  ) => Effect.Effect<FileTree, TargetError>;
}

/**
 * Whether a value is a target.
 *
 * @category guards
 * @since 0.1.0
 */
export const isTarget = (u: unknown): u is Target =>
  P.isObject(u) &&
  P.isString(u["name"]) &&
  Schema.isSchema(u["options"]) &&
  P.isObject(u["capabilities"]) &&
  P.isFunction(u["emit"]);

/**
 * The function a config lists a target with: `debug({ file: "ir.json" })`
 * after `const debug = Target.make({ ... })`.
 *
 * @category constructors
 * @since 0.1.0
 */
export const make =
  <S extends OptionsSchema>(target: Target<S>) =>
  (options: S["Encoded"]): ConfigTarget<S> => ({
    target: target.name,
    options,
    schema: target.options,
    plugin: target,
  });
