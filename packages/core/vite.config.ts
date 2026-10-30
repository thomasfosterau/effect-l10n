import { defineConfig } from "vite-plus";

/**
 * What invalidates a cached task: Vite Task's automatic tracking of the files
 * a task reads, minus `node_modules`, plus the workspace lockfile.
 */
const cacheInputs = [{ auto: true }, "!node_modules/**", "!dist/**", "../../pnpm-lock.yaml"];

export default defineConfig({
  run: {
    tasks: {
      // The package's type gate (src, tests and this config).
      check: {
        command: "tsc --noEmit -p tsconfig.json",
        cache: { input: cacheInputs, output: [] },
      },
      // `vp pack` (tsdown): one ESM bundle and declaration file.
      build: {
        command: "vp pack",
        cache: { input: cacheInputs, output: ["dist/**"] },
      },
      "test:unit": {
        command: "vp test run",
        cache: { input: cacheInputs, output: [] },
      },
    },
  },
  pack: { entry: ["src/index.ts"], dts: true, format: ["esm"] },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
