# effect-l10n

An experimental Effect library and CLI for internationalisation (i18n), globalisation (g11n), and localisation (l10n).

Messages are authored in TypeScript with [Effect](https://effect.website), written in [Unicode MessageFormat 2](https://messageformat.unicode.org), typed end to end, and compiled to each platform's native format: tree-shakeable, dependency-free JavaScript for the web, String Catalogs and Swift for Apple, `strings.xml` and Kotlin for Android, and more.

> **Status:** pre-release. The workspace is being set up (milestone M0); nothing is published to npm yet. The [roadmap](https://github.com/thomasfosterau/effect-l10n/issues/2) tracks the milestones.

## Design

The agreed design decisions are recorded as [architecture decision records](docs/adr/README.md):

1. [TS-first authoring with interchange round-trip](docs/adr/0001-ts-first-authoring.md)
2. [MessageFormat 2 as the message syntax](docs/adr/0002-messageformat-2.md)
3. [Effect only at build time; web output is plain JS](docs/adr/0003-effect-at-build-time-only.md)
4. [Typed native accessors alongside the resource files](docs/adr/0004-typed-native-accessors.md)
5. [Paraglide-style locale strategies for the web runtime](docs/adr/0005-web-locale-strategies.md)
6. [The package layout](docs/adr/0006-package-layout.md)

## License

[MIT](LICENSE)
