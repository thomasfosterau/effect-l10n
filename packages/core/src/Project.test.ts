import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import { assert, describe, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ProjectConfig } from "./Config";
import { ModuleLoader, ModuleLoadError } from "./ModuleLoader";
import { load } from "./Project";

const root = new URL("__fixtures__/web/", import.meta.url).pathname;

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const loader = ModuleLoader.layer.pipe(Layer.provide(platform));
const project = Layer.mergeAll(
  ProjectConfig.layer(`${root}effect-l10n.config.ts`).pipe(Layer.provide(loader)),
  loader,
  platform,
);

describe("load", () => {
  it.layer(project)((scoped) => {
    scoped.effect("loads the example project", (context) =>
      Effect.gen(function* () {
        const loaded = yield* load(root);
        context
          .expect({
            locales: loaded.locales,
            fallbacks: loaded.fallbacks,
            messages: Arr.map(loaded.messages, (m) => ({
              id: m.id,
              file: m.file,
              parsed: m.model !== undefined,
              description: m.message.description,
            })),
            translations: Arr.map(loaded.translations, (t) => [t.locale, t.messageId, t.state]),
            diagnostics: Arr.map(loaded.diagnostics, (d) => ({
              code: d.code,
              severity: d.severity,
              file: d.file,
              messageId: d.messageId,
              locale: d.locale,
            })),
          })
          .toMatchSnapshot();
      }),
    );

    scoped.effect("points parse errors at the message's span", () =>
      Effect.gen(function* () {
        const loaded = yield* load(root);
        const broken = Arr.findFirst(loaded.diagnostics, (d) => d.messageId === "checkout.broken");
        assert.isTrue(Option.isSome(broken) && "span" in broken.value.reason);
      }),
    );
  });

  it.layer(loader)((scoped) => {
    scoped.effect("fails with the file for a module that doesn't load", () =>
      Effect.gen(function* () {
        const module = yield* ModuleLoader;
        const error = yield* Effect.flip(module.load(`${root}missing.ts`));
        assert.instanceOf(error, ModuleLoadError);
        assert.include(error.file, "missing.ts");
      }),
    );
  });
});
