# @effect-l10n/testing

Test helpers shared by the workspace's packages. Private: a workspace dev dependency (`"@effect-l10n/testing": "workspace:*"`), never published.

- `expectGoldenTree(tree, directory)` — compares an emitted file tree (`FileTree`: relative POSIX paths to file text) with the committed snapshots under `directory`, one file per emitted file. Run it inside `it.effect` with the exported `layer` (Node `FileSystem` + `Path`). `vp test run -u` rewrites the snapshots; a committed file the tree no longer emits fails until deleted.

`src/golden.test.ts` is the worked example: a stub target compiled over a two-locale fixture, checked against `src/__golden__/stub-target/`, plus the `it.prop` round-trip property the MF2 parser's tests follow. [CONTRIBUTING.md](../../CONTRIBUTING.md#testing) has the whole test strategy.
