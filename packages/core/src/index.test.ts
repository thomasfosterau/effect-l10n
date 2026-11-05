import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

// A toolchain smoke test: `effect` resolves to the workspace singleton, the
// patched `tsc` type-checks Effect code, and `@effect/vitest` runs it.
it.effect("runs an Effect program", () =>
  Effect.gen(function* () {
    const name = yield* Effect.succeed("effect-l10n");
    assert.strictEqual(name, "effect-l10n");
  }),
);
