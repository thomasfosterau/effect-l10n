/**
 * `@thomasfosterau/effect-l10n`: the authoring API (locales, `Message.make`,
 * catalogs, translations and `defineConfig`, milestone M2, #5). Nothing is
 * exported until M2 starts; the package exists so the workspace's type gate,
 * build and release pipeline run against a real package from the start.
 *
 * This root module may import `./messageformat`, never `./compiler`
 * (ADR 0007; the boundary zones in `.fallowrc.json` enforce it).
 *
 * @since 0.1.0
 */
