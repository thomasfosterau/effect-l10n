// The Vite+ configuration every package shares; each
// `packages/<name>/vite.config.ts` instantiates it.
import { defineConfig } from "vite-plus";

// The lockfile is added back so a dependency bump reruns cached tasks.
const cacheInputs = [{ auto: true }, "!node_modules/**", "!dist/**", "../../pnpm-lock.yaml"];

// Siblings are consumed through their `exports`, i.e. `dist/`, so tasks build
// workspace dependencies first.
const siblingBuild = { task: "build", from: "dependencies" } as const;

/** `entry`: `vp pack` entries by output path under `dist/`, one per `exports` subpath. */
export const packageConfig = (
  entry: Readonly<Record<string, string>> = { index: "src/index.ts" },
) =>
  defineConfig({
    run: {
      tasks: {
        check: {
          command: "tsc --noEmit -p tsconfig.json",
          dependsOn: [siblingBuild],
          cache: { input: cacheInputs, output: [] },
        },
        build: {
          command: "vp pack",
          dependsOn: [siblingBuild],
          cache: { input: cacheInputs, output: ["dist/**"] },
        },
        // Lints what npm would receive. `npm pack` avoids a pnpm self-switch.
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
      deps: {
        // tsdown <0.23 compatibility: resolve external dependency subpaths.
        // Remove to preserve subpath imports as written (the new default).
        // https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
        resolveDepSubpath: true,
      },
    },
    test: {
      include: ["src/**/*.test.ts"],
      passWithNoTests: true,
    },
  });
