import { defineConfig } from "@thomasfosterau/effect-l10n/Config";
import { debug } from "@thomasfosterau/effect-l10n/compiler/Debug";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "de"],
  catalogs: ["src/**/*.messages.ts"],
  targets: [debug({})],
});
