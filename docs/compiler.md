# The compiler

> [!WARNING]
> Experimental: the `Target` interface and the IR will change as the platform targets land.

The compiler turns a project (its config, catalogs and translations) into each target's files. It lives in `@thomasfosterau/effect-l10n/compiler`; `@thomasfosterau/effect-l10n-node` runs it on Node.

## Running it

From a script, without Effect:

```ts
import { compile } from "@thomasfosterau/effect-l10n-node/NodeCompiler";

const { ok, report } = await compile({ cwd: process.cwd() });
process.stdout.write(report);
if (!ok) process.exitCode = 1;
```

With Effect, provide `NodeCompiler.layer({ cwd })` (or `Compiler.layer({ root })` with your own `ProjectConfig`, `ModuleLoader`, `FileSystem` and `Path`) and use the `Compiler` service:

- `build` loads the project, compiles it and writes each target's files to `<outDir>/<target>/` (`outDir` is `generated/l10n` unless the config says otherwise).
- `watch` builds, then builds again after each burst of changes under the root (debounced, 100 ms by default), ignoring the output directory. A failed build is a failed `Result` in the stream, and the next change builds again.
- `compile` compiles a loaded project without writing anything.
- `locate` places a build's findings in their files, for the renderers in `Report` ([diagnostics](diagnostics.md#rendering)).

Builds are incremental. Each target's lowered messages are cached by their content and the target's capabilities, so a change re-lowers only the messages it touches. A target writes only the files whose contents changed, and removes the files it wrote last time but no longer emits (it keeps a `.effect-l10n-manifest.json` in its directory). Output is deterministic: messages are sorted by ID, so two builds of the same project are byte-identical.

In watch mode, edited catalogs are re-imported, but modules they import are not, and a changed config needs a restart.

## Pipeline

1. **Load.** `Project.load` reads the config, imports the catalogs, reads the translations and validates everything ([diagnostics](diagnostics.md)).
2. **IR.** `Ir.fromProject` gives each message, by ID, its parameters, its metadata and, for each locale, the data model it formats with there: its translation, or the next one along the locale's fallback chain.
3. **Plan.** `Plan.fromMessage` turns a message's selection into a decision tree ([ADR 0008](adr/0008-selection-plans.md)): a `Switch` per selector, a `Chain` that falls through, a `Leaf` pattern.
4. **Lower.** `Lowering` rewrites each locale's plan for a target's `Capabilities`, and reports what the target can't express.
5. **Emit.** Each target's `emit` turns the lowered project into a file tree. Targets run concurrently; one that fails is reported as `target-failed` and doesn't stop the others.

## Writing a target

A target is a `Target`: a name, an options schema, its capabilities and `emit`. `Target.make` turns it into the function a config calls.

```ts
import * as Target from "@thomasfosterau/effect-l10n/compiler/Target";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const strings = Target.make({
  name: "strings",
  options: Schema.Struct({ file: Schema.String }),
  capabilities: {
    selectors: "plural",
    maxSelectors: 1,
    hasExactKeys: false,
    functions: ["integer", "number", "string"],
    markup: "strip",
    hasAccessors: true,
  },
  emit: (project, options) => Effect.succeed({ [options.file]: render(project) }),
});

// effect-l10n.config.ts: targets: [strings({ file: "strings.txt" })]
```

`Capabilities` says what the target's resources hold natively:

| Capability     | Meaning                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `selectors`    | Which selectors its resources hold: `any`, `plural` (CLDR categories, as Android `<plurals>`), `none` |
| `maxSelectors` | How many resource selectors may nest; unbounded if absent                                             |
| `hasExactKeys` | Whether its plural resources hold exact numbers, such as `=0`                                         |
| `functions`    | The functions it formats natively, or `all`                                                           |
| `markup`       | Whether it `keep`s markup or `strip`s it                                                              |
| `hasAccessors` | Whether it generates accessor code, which takes what its resources can't                              |

In the lowered project, each locale's message has a `plan` whose `Switch`es are each `at` the `resource` or the `accessor`, its `declarations`, and `preformat`: expressions the accessor formats ahead into fresh string parameters (`_0`, `_1`, …) that the patterns read in their place. `Plan.evaluate` is the reference semantics the emitted resources and accessors must agree with.

Targets ship as their own packages, starting with [the web target](web.md). The `debug` target (`compiler/Debug`) writes the lowered project as JSON (`ir.json`), which shows exactly what `emit` receives.
