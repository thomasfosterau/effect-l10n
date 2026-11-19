import { recommended as effectTsgo } from "@effect/tsgo/oxlint-presets";
import effect from "@enfect/oxlint";
import { defineConfig } from "vite-plus";

// Auto tracking minus node_modules churn, with the lockfile back so a
// dependency upgrade still invalidates cached tasks.
const cacheInputs = [{ auto: true }, "!node_modules/**", "!coverage/**", "pnpm-lock.yaml"];

export default defineConfig({
  // Each package's `check`, `build`, `check:package` and `test:unit` come from
  // vite.package.ts.
  run: {
    tasks: {
      // Everything CI runs, in order. `vp run ci` locally is the same run.
      ci: {
        command:
          "vp check && vp run check && vp run -r test:unit && vp run -r build && vp run -r check:package && pnpm audit --audit-level high",
        cache: false,
      },
      // The type gate: every package's `tsc`, then the root configs. A new
      // package adds its edge here.
      check: {
        command: "tsc --noEmit -p tsconfig.json",
        dependsOn: [
          "@thomasfosterau/effect-l10n#check",
          "@thomasfosterau/effect-l10n-testing#check",
        ],
        cache: { input: cacheInputs, output: [] },
      },
      // Writes coverage/coverage-final.json, which `fallow audit` reads.
      "test:coverage": {
        command: "vp test run --coverage",
        cache: false,
      },
      fallow: {
        command: "vp exec fallow --summary",
        cache: false,
      },
      // Run by the pre-commit hook.
      "fallow:audit": {
        command: "vp exec fallow audit --base origin/trunk --quiet",
        dependsOn: ["test:coverage"],
        cache: false,
      },
      "changeset:version": {
        command: "changeset version && vp fmt && pnpm install --lockfile-only",
        cache: false,
      },
      "changeset:publish": {
        command: "changeset publish",
        dependsOn: ["@thomasfosterau/effect-l10n#build"],
        cache: false,
      },
    },
  },
  // Format with fixes, lint without, so no unverified type-aware autofix lands
  // at commit time.
  staged: {
    "*": ["vp check --fix --no-lint", "vp check --no-fmt --no-error-on-unmatched-pattern"],
  },
  test: {
    projects: ["packages/*"],
    coverage: {
      provider: "istanbul",
      reporter: ["text-summary", "json-summary", "json"],
      reportsDirectory: "./coverage",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.d.ts", "**/*.test.ts"],
    },
  },
  lint: {
    extends: [effectTsgo, effect.configs.recommended],
    plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "promise", "vitest", "jsdoc"],
    categories: {
      correctness: "error",
      suspicious: "error",
      perf: "error",
    },
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      // `_tag` is Effect's discriminant (tagged errors, Option, Result).
      "eslint/no-underscore-dangle": ["error", { allow: ["_tag"] }],
      // `@since` / `@category` are Effect's doc-comment tags.
      "jsdoc/check-tag-names": ["error", { definedTags: ["since", "category"] }],
      // `@effect/vitest`'s `it` is marked `@stability unstable`; the patched
      // `tsc` already reports it as a suggestion.
      "effecttsgo/unstable-api-usage": "off",
      // Vitest's `expect(value, message)` takes a failure message as its
      // second argument; the rule's default of one argument is Jest's.
      "vitest/valid-expect": ["error", { maxArgs: 2 }],
    },
    overrides: [
      // Entries scaffolded ahead of their milestone hold only a module doc
      // comment until there is API to export.
      {
        files: ["packages/*/src/index.ts", "packages/*/src/*/index.ts"],
        rules: { "unicorn/no-empty-file": "off" },
      },
      // Assertion helpers wrap `expect` and are called from inside test blocks.
      {
        files: ["packages/testing/src/**/*.ts"],
        rules: { "vitest/no-standalone-expect": "off" },
      },
    ],
    ignorePatterns: ["**/dist/**", "coverage/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    // `__golden__/` holds committed target output, compared byte for byte.
    ignorePatterns: [
      "**/dist/**",
      "coverage/**",
      "**/__golden__/**",
      "CHANGELOG.md",
      ".changeset/*.md",
    ],
    sortPackageJson: true,
  },
});
