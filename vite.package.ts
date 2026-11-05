/**
 * The Vite+ configuration every package in this workspace shares: the task
 * graph (`check`, `build`, `test:unit`), the `vp pack` (tsdown) settings and
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

/** The shared configuration, for a package's `vite.config.ts` to export. */
export const packageConfig = () =>
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
        "test:unit": {
          command: "vp test run",
          dependsOn: [siblingBuild],
          cache: { input: cacheInputs, output: [] },
        },
      },
    },
    pack: {
      entry: ["src/index.ts"],
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
