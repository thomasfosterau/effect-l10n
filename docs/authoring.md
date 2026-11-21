# Authoring

How a project's source messages, catalogs, config and translations fit together. The API reference is in each module's doc comments.

## Messages

`Message.make(source, options)` declares a source-locale message in MessageFormat 2. Without `params`, the parameter types are inferred from the pattern; with `params`, each schema's type must fit what the pattern reads the parameter as. The options also carry translator notes: `description`, `context`, `maxLength`, `screenshots`, `doNotTranslate` and `tags`. Making a message parses nothing; the project loader parses and validates every message.

## Catalogs and message IDs

A catalog is a module whose exports are messages. Exported plain objects are namespaces, and `Catalog.make({ ... })` types one. A `default` export that is an object is read as the module's root. A message's ID is its export path (`checkout.total`), unless it sets `id`. All catalog files matched by the config's `catalogs` globs share one namespace, so the same ID in two files is a `duplicate-message-id` error.

An ID is dot-separated identifiers, each matching `[A-Za-z][A-Za-z0-9_]*`. Targets mangle it the same way every time:

| Platform      | Rule                                              | `checkout.totalPrice`  |
| ------------- | ------------------------------------------------- | ---------------------- |
| Android       | each segment in `snake_case`, joined by `_`       | `checkout_total_price` |
| Swift, Kotlin | each segment in `camelCase`, as nested namespaces | `checkout.totalPrice`  |

Two IDs that mangle to the same identifier, such as `fooBar` and `foo_bar`, are a `message-id-collision` error.

## Locales and fallback

Locales are canonical BCP 47 tags. A locale without a translation falls back along its chain: the config's `fallbacks` entry for it, otherwise its CLDR parents (`de-CH` → `de`, `en-AU` → `en-001`, `es-MX` → `es-419` → `es`), then the source locale.

## Translations

Until the interchange formats land, translations are JSON files in `translations.dir`, one per locale:

```json
{
  "locale": "de",
  "messages": {
    "greeting": "Hallo, {$name}!",
    "checkout.total": {
      "source": "Summe: {$amount :currency currency=EUR}",
      "state": "reviewed",
      "sourceHash": "1a2b3c4d"
    }
  }
}
```

Each translation is checked against its source message: `unknown-variable` and `selector-mismatch` are errors; `missing-variable`, `missing-plural-category` (for the target locale's CLDR categories), `stale-translation`, `extra-translation` and `missing-translation` are warnings. The config's `severities` changes any finding's severity, or turns it `off`.
