# @thomasfosterau/effect-l10n-testing

Test helpers shared by the workspace. Private: add it as `"@thomasfosterau/effect-l10n-testing": "workspace:*"` in `devDependencies`; never published.

- `expectGoldenTree(tree, directory)` compares an emitted file tree (relative POSIX paths to file text) with the committed snapshots under `directory`. Run it inside `it.effect` with the exported `layer` (Node `FileSystem` and `Path`). `vp test run -u` rewrites the snapshots; a committed file the tree no longer emits fails until deleted.

`src/golden.test.ts` is the worked example.
