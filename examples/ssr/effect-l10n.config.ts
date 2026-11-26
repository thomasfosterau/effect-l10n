import { defineConfig } from "@thomasfosterau/effect-l10n/Config";
import { web } from "@thomasfosterau/effect-l10n-web/WebTarget";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "de"],
  catalogs: ["src/**/*.messages.ts"],
  targets: [
    web({
      strategy: ["url", "cookie", "header", "baseLocale"],
      // Every locale has a prefix, so an unprefixed URL falls through to the
      // cookie and Accept-Language, and redirects to the locale they name.
      url: { prefixBaseLocale: true, pathnames: { "/about": { de: "/ueber-uns" } } },
    }),
  ],
});
