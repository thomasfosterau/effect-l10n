# AGENTS.md

Read [README.md](README.md) and [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) first; this file adds only what is specific to agents.

## Process

- You may open pull requests in this repository (GitHub MCP tools or `gh`, whichever is available). GitHub writes go to `thomasfosterau/effect-l10n` only.
- When you spot work outside your task, file an issue and move on.
- Write idiomatic Effect (see docs/CONTRIBUTING.md). Non-idiomatic code you find: fix it if trivial, otherwise file an issue naming the sites and the idiomatic replacement.
- Before reporting work as done, run the gates in docs/CONTRIBUTING.md and say which passed and which couldn't run.

## Pitfalls

- **`effect-tsgo patch` is version-locked.** `@effect/tsgo`, `@typescript/native` and `vite-plus` move together, or `vp install` fails; read the catalog comments first.
- **TypeScript 6 and 7 side by side.** `typescript` is TS6 (bin `tsc6`) for JS-API consumers; `@typescript/native` is TS7 (bin `tsc`), which the `check` tasks run.
- **`dist/` is the product.** Siblings resolve each other through `exports`, i.e. `dist/`; go through `vp run`, whose tasks build dependencies first.
- **`sideEffects: false`**: no top-level statements with effects in `src/`.
