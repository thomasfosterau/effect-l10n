/**
 * The debug target: writes the lowered project as JSON, to test the
 * compiler and to show target authors exactly what `emit` receives.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as Lowering from "./Lowering";
import { make, type Target, TargetError } from "./Target";

/**
 * The debug target's options: `file`, the file to write in the target's
 * directory, `ir.json` by default.
 *
 * @category options
 * @since 0.1.0
 */
export const Options = Schema.Struct({
  file: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed("ir.json"))),
});

/**
 * @category options
 * @since 0.1.0
 */
export type Options = typeof Options.Type;

const Json = Schema.fromJsonString(Schema.toCodecJson(Lowering.Project), { space: 2 });
const formatter = SchemaIssue.makeFormatterDefault();

/**
 * The debug target itself.
 *
 * @category targets
 * @since 0.1.0
 */
export const target: Target<typeof Options> = {
  name: "debug",
  options: Options,
  capabilities: {
    selectors: "any",
    hasExactKeys: true,
    functions: "all",
    markup: "keep",
    hasAccessors: true,
  },
  emit: (project, options) =>
    Schema.encodeEffect(Json)(project).pipe(
      Effect.map((json) => ({ [options.file]: `${json}\n` })),
      Effect.mapError(
        (error) => new TargetError({ target: "debug", details: formatter(error.issue) }),
      ),
    ),
};

/**
 * Lists the debug target in a config: `targets: [debug({})]`.
 *
 * @category constructors
 * @since 0.1.0
 */
export const debug = make(target);
