# @thomasfosterau/effect-l10n-web

The effect-l10n web target: one tree-shakeable ES module per message with its `.d.ts`, a small locale runtime with configurable strategies, URL helpers and SSR middleware, all plain JavaScript over `Intl`. Private until its first release.

```ts
import { web } from "@thomasfosterau/effect-l10n-web/WebTarget";

// effect-l10n.config.ts: targets: [web({ strategy: ["url", "cookie", "baseLocale"] })]
```

See [the web target guide](../../docs/web.md).
