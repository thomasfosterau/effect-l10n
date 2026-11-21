# effect-l10n

An [Effect](https://effect.website) library and CLI for internationalisation and localisation: messages authored in TypeScript, written in [Unicode MessageFormat 2](https://messageformat.unicode.org), typed end to end, and compiled to each platform's native format (plain JavaScript for the web, String Catalogs and Swift, `strings.xml` and Kotlin).

> [!CAUTION]
> Experimental and pre-1.0, largely written with Claude Code; the API will change. Nothing is published to npm yet: the workspace is scaffolded ahead of the first milestones.

## Packages

| Package                                        | Contents                                                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`@thomasfosterau/effect-l10n`](packages/core) | The core: the MessageFormat 2 engine (`/messageformat`), the authoring API (root) and the compiler (`/compiler`) |
| `@thomasfosterau/effect-l10n-<name>`           | Platform targets, the CLI and bundler plugins, each its own package as its milestone starts                      |

Once released: `vp add @thomasfosterau/effect-l10n effect` (`effect` is a peer).

## More

- [Authoring messages, catalogs and translations](docs/authoring.md)
- [Design decisions (ADRs)](docs/adr/README.md)
- [Contributing](docs/CONTRIBUTING.md) and [publishing](docs/PUBLISHING.md)
- License: [MIT](LICENSE.md)
