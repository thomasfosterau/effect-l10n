import { defineConfig } from "../../Config";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "de", "pl"],
  catalogs: ["src/l10n/**/*.messages.ts"],
  translations: { format: "json", dir: "translations" },
  severities: { "missing-translation": "error" },
});
