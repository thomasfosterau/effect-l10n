# @thomasfosterau/effect-l10n-node

The effect-l10n compiler on Node. Private until its first release.

- `NodeCompiler.layer({ cwd })`: the `Compiler` service for the project in `cwd`, reading `effect-l10n.config.ts` and the project's files through Node.
- `NodeCompiler.compile({ cwd })`: one build, as a Promise, for scripts that don't use Effect. It resolves to `{ ok, result, report }`, where `report` is the findings as plain text.

See [the compiler guide](../../docs/compiler.md).
