import effect from "@enfect/oxlint";
import { defineConfig } from "vite-plus";

/**
 * What invalidates a cached task: Vite Task's automatic tracking of the files
 * a task reads, minus `node_modules`, plus the lockfile (a dependency bump
 * reruns the type check).
 */
const cacheInputs = [{ auto: true }, "!node_modules/**", "!coverage/**", "pnpm-lock.yaml"];

export default defineConfig({
  // The gates are Vite Task tasks rather than package.json scripts, so they are
  // cached and `vp run check` never collides with the built-in `vp check`.
  // Each package declares its own `check`, `build` and `test:unit`
  // (packages/*/vite.config.ts); the root `check` runs them first.
  run: {
    tasks: {
      // The type gate: every package's `tsc`, then the root configs.
      check: {
        command: "tsc --noEmit -p tsconfig.json",
        dependsOn: ["@effect-l10n/core#check"],
        cache: { input: cacheInputs, output: [] },
      },
      // Uncached: it exists to write `coverage/coverage-final.json`, which the
      // fallow PreToolUse gate reads and never refreshes.
      "test:coverage": {
        command: "vp test run --coverage",
        cache: false,
      },
    },
  },
  // Format with fixes, lint without: with type-aware lint on, `vp check --fix`
  // would silently apply type-aware autofixes (even of `warn` rules) to staged
  // files at commit time, so the commit would differ from the tree that was
  // verified. A commit staging only files the linter ignores must not fail.
  staged: {
    "*": ["vp check --fix --no-lint", "vp check --no-fmt --no-error-on-unmatched-pattern"],
  },
  test: {
    // Every package is a Vitest project with its own vite.config.ts.
    projects: ["packages/*"],
    // `vp run test:coverage` writes the Istanbul map `coverage/coverage-final.json`,
    // which `fallow audit` reads for exact per-function CRAP scores
    // (`health.coverage` in .fallowrc.json). Without it fallow scores every
    // function as uncovered.
    coverage: {
      provider: "istanbul",
      reporter: ["text-summary", "json-summary", "json"],
      reportsDirectory: "./coverage",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.d.ts", "**/*.test.ts"],
    },
  },
  lint: {
    extends: [effect.configs.recommended],
    plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "promise", "vitest", "jsdoc"],
    // Oxlint's own categories on top of the Effect preset: `correctness`
    // (the default), plus `suspicious` and `perf`, at `error` like the preset.
    categories: {
      correctness: "error",
      suspicious: "error",
      perf: "error",
    },
    // Vite+'s own plugin: `vitest` / `oxlint` imports go through `vite-plus`.
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      // `_tag` is Effect's discriminant (tagged errors, Option, Result).
      "eslint/no-underscore-dangle": ["error", { allow: ["_tag"] }],
      // `@since` / `@category` are Effect's doc-comment tags.
      "jsdoc/check-tag-names": ["error", { definedTags: ["since", "category"] }],
    },
    ignorePatterns: ["**/dist/**", "coverage/**"],
    // Type-aware rules through oxlint-tsgolint (bundled with vite-plus, no
    // separate install). tsgolint reads each file's nearest tsconfig.json
    // (the package's, or the root one for this config). `typeCheck` also
    // reports TypeScript errors in `vp check`; it overlaps the plain-`tsc`
    // `vp run check` gate without conflicting.
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: ["**/dist/**", "coverage/**", "CHANGELOG.md", ".changeset/*.md"],
    sortPackageJson: true,
  },
});
