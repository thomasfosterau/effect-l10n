import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { expectTypeOf } from "vite-plus/test";
import {
  ConfigError,
  decode,
  defineConfig,
  defineTarget,
  type Input,
  type LocaleOf,
  ProjectConfig,
} from "./Config";

const web = defineTarget("web", Schema.Struct({ outDir: Schema.String }));

const config = defineConfig({
  sourceLocale: "en",
  locales: ["en", "de", "fr-CA"],
  fallbacks: { "fr-CA": ["en"] },
  catalogs: ["src/**/*.messages.ts"],
  targets: [web({ outDir: "src/generated" })],
});

describe("defineConfig", () => {
  it("types locales as a literal union", () => {
    expectTypeOf<LocaleOf<typeof config>>().toEqualTypeOf<"en" | "de" | "fr-CA">();
    expectTypeOf<{
      readonly sourceLocale: "fr";
      readonly locales: ReadonlyArray<"en">;
      readonly catalogs: readonly ["x"];
    }>().not.toExtend<Input<"en">>();
    expectTypeOf<{
      readonly sourceLocale: "en";
      readonly locales: ReadonlyArray<"en">;
      readonly fallbacks: { readonly en: ReadonlyArray<"de-CH"> };
      readonly catalogs: readonly ["x"];
    }>().not.toExtend<Input<"en">>();
  });

  it("types target options by the target's schema", () => {
    expectTypeOf(web).parameter(0).toEqualTypeOf<{ readonly outDir: string }>();
  });
});

describe("decode", () => {
  it.effect("canonicalises locales and fills defaults", () =>
    Effect.gen(function* () {
      const decoded = yield* decode({
        sourceLocale: "EN",
        locales: ["EN", "de-ch"],
        catalogs: ["a"],
      });
      assert.deepStrictEqual<ReadonlyArray<string>>(decoded.locales, ["en", "de-CH"]);
      assert.deepStrictEqual(decoded.translations, { format: "json", dir: "translations" });
      assert.deepStrictEqual(
        [decoded.fallbacks, decoded.targets, decoded.severities],
        [{}, [], {}],
      );
    }),
  );

  it.effect("reports problems with their path", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decode({ sourceLocale: "en", locales: ["en", "de_CH"], catalogs: [] }),
      );
      assert.instanceOf(error, ConfigError);
      assert.include(error.details, "locales");
      assert.include(error.details, "catalogs");
    }),
  );

  it.effect("checks sourceLocale and fallbacks against locales", () =>
    Effect.gen(function* () {
      const source = yield* Effect.flip(
        decode({ sourceLocale: "fr", locales: ["en"], catalogs: ["a"] }),
      );
      assert.include(source.details, "sourceLocale fr");
      const fallbacks = yield* Effect.flip(
        decode({ sourceLocale: "en", locales: ["en"], fallbacks: { de: ["en"] }, catalogs: ["a"] }),
      );
      assert.include(fallbacks.details, "fallbacks has de");
    }),
  );

  it.effect("decodes each target's options with its schema", () =>
    Effect.gen(function* () {
      const bad = {
        target: "web",
        options: { outDir: 1 },
        schema: Schema.Struct({ outDir: Schema.String }),
      };
      const error = yield* Effect.flip(
        decode({ sourceLocale: "en", locales: ["en"], catalogs: ["a"], targets: [bad] }),
      );
      assert.include(error.details, "targets[0] (web).options");
      assert.include(error.details, "outDir");
    }),
  );
});

describe("ProjectConfig", () => {
  it.layer(ProjectConfig.layerTest(config))((scoped) => {
    scoped.effect("provides the decoded config", () =>
      Effect.gen(function* () {
        const project = yield* ProjectConfig;
        assert.strictEqual(project.sourceLocale, "en");
        assert.strictEqual(project.targets[0]?.target, "web");
      }),
    );
  });
});
