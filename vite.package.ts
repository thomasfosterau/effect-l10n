/**
 * The Vite+ configuration every package in this workspace shares: the task
 * graph (`check`, `build`, `check:package`, `test:unit`), the `vp pack` (tsdown) settings and
 * the Vitest settings. Each `packages/<name>/vite.config.ts` is a one-call
 * instantiation of it, so a new package copies one line rather than a config.
 */
import { defineConfig } from "vite-plus";

/**
 * What invalidates a package's cached task: Vite Task's automatic tracking of
 * the files it reads, minus `node_modules` and its own output, plus the
 * workspace lockfile (a dependency bump reruns the type gate and the tests).
 */
const cacheInputs = [{ auto: true }, "!node_modules/**", "!dist/**", "../../pnpm-lock.yaml"];

/**
 * A workspace sibling is consumed the way a consumer consumes it: through its
 * `exports`, so its `dist/`. Every task that resolves one first builds the
 * package's workspace dependencies; a package with none gets an empty edge.
 */
const siblingBuild = { task: "build", from: "dependencies" } as const;

/**
 * The shared configuration, for a package's `vite.config.ts` to export.
 * `entry` is the `vp pack` entries by output path under `dist/` (without the
 * extension), one per `exports` subpath; it defaults to `src/index.ts` alone.
 */
export const packageConfig = (
  entry: Readonly<Record<string, string>> = { index: "src/index.ts" },
) =>
  defineConfig({
    run: {
      tasks: {
        // The package's type gate: src, tests and its vite.config.ts, under
        // the native `tsc` patched with the Effect language service.
        check: {
          command: "tsc --noEmit -p tsconfig.json",
          dependsOn: [siblingBuild],
          cache: { input: cacheInputs, output: [] },
        },
        // The published artifact: one ESM bundle and declaration file.
        build: {
          command: "vp pack",
          dependsOn: [siblingBuild],
          cache: { input: cacheInputs, output: ["dist/**"] },
        },
        // What npm would receive (both pack with `npm pack`, which needs no
        // pnpm self-switch and lists the same files): publint lints the manifest and `exports`
        // against the files, and attw resolves the packed tarball's types
        // the way each consumer `moduleResolution` does (ESM only, so the
        // CommonJS `node10` / `node16-cjs` modes are out of profile).
        "check:package": {
          command: "publint --strict --pack npm && attw --pack . --profile esm-only",
          dependsOn: ["build"],
          cache: { input: cacheInputs, output: [] },
        },
        "test:unit": {
          command: "vp test run",
          dependsOn: [siblingBuild],
          cache: { input: cacheInputs, output: [] },
        },
      },
    },
    pack: {
      entry: { ...entry },
      format: ["esm"],
      platform: "neutral",
      dts: true,
      clean: true,
    },
    test: {
      include: ["src/**/*.test.ts"],
      // A package scaffolded ahead of its milestone has no tests yet.
      passWithNoTests: true,
    },
  });
