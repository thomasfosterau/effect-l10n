# Diagnostics

Every problem the MessageFormat 2 engine reports is a `MessageFormatError` whose tagged `reason` has a `code`. Spec codes are the [MF2 error names](https://github.com/unicode-org/message-format-wg/blob/main/spec/errors.md). Lint codes are effect-l10n's own. Validation (`Validation.check`) reports the data model errors and lint warnings as `Diagnostic`s, and keeps going after the first.

| Code                          | Reason                      | Severity | Reported by | Meaning                                                                                            |
| ----------------------------- | --------------------------- | -------- | ----------- | -------------------------------------------------------------------------------------------------- |
| `syntax-error`                | `InvalidSyntax`             | error    | parser      | The source isn't a well-formed message; `expected` says what the parser was looking for.           |
| `duplicate-option-name`       | `DuplicateOptionName`       | error    | parser      | A function or markup sets the same option twice.                                                   |
| `variant-key-mismatch`        | `VariantKeyMismatch`        | error    | validation  | A variant's number of keys differs from the number of selectors.                                   |
| `missing-fallback-variant`    | `MissingFallbackVariant`    | error    | validation  | No variant has only `*` keys.                                                                      |
| `missing-selector-annotation` | `MissingSelectorAnnotation` | error    | validation  | A selector's variable doesn't lead, through its declarations, to an expression with a function.    |
| `duplicate-declaration`       | `DuplicateDeclaration`      | error    | validation  | A variable is declared twice, or declared after an earlier declaration (or its own value) used it. |
| `duplicate-variant`           | `DuplicateVariant`          | error    | validation  | Two variants have the same keys (literal keys compared after NFC normalization).                   |
| `unused-local`                | `UnusedLocal`               | warning  | validation  | A `.local` variable is never used.                                                                 |
| `unreachable-variant`         | `UnreachableVariant`        | warning  | validation  | A `:number` / `:integer` selector can never produce this key in the given locale (needs `locale`). |
| `bad-operand`                 | `BadOperand`                | error    | function    | A function can't use its operand's value or type; the expression falls back.                       |
| `bad-option`                  | `BadOption`                 | error    | function    | A function can't use an option's value, or a variable set an option that needs a literal.          |
| `bad-variant-key`             | `BadVariantKey`             | error    | function    | A selector can't compare against a key, such as a `:number` key that's no number or category.      |
| `unresolved-variable`         | `UnresolvedVariable`        | error    | formatter   | A variable is neither declared nor a parameter; it falls back to `$name`.                          |
| `unknown-function`            | `UnknownFunction`           | error    | formatter   | No function has this name, or it is a draft and `DraftFunctions` is off.                           |
| `bad-selector`                | `BadSelector`               | error    | formatter   | A selector's value can't select, so only `*` keys match it.                                        |
| `unsupported-operation`       | `UnsupportedOperation`      | error    | function    | A function accepts the request but can't carry it out, such as `:unit` with `usage`.               |

Function errors (`FunctionError`) come from a function handler while a message is formatted; the formatter reports them, and its own resolution errors, alongside the output rather than instead of it. A message with data model errors formats as `{�}`. A `bad-option` usually leaves out just that option and a `bad-variant-key` just that key, while `bad-operand` and `unsupported-operation` make the expression fall back.

The parser reports `duplicate-option-name` because the data model's options are a record, which can't hold a duplicate. A variable declared twice is always `duplicate-declaration`, so there's no separate shadowing warning.

## Project diagnostics

The project loader (`Project.load`) reports every finding above for each source message and translation, plus its own, as the root entry's `Diagnostic`, with the `file`, `messageId` and `locale` it was found at. The config's `severities` overrides any code's severity, or turns it `off`.

| Code                      | Reason                  | Severity | Meaning                                                                                  |
| ------------------------- | ----------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `invalid-message-id`      | `InvalidMessageId`      | error    | An ID isn't dot-separated identifiers (`[A-Za-z][A-Za-z0-9_]*`).                         |
| `duplicate-message-id`    | `DuplicateMessageId`    | error    | Two messages, in one catalog file or several, have the same ID.                          |
| `message-id-collision`    | `MessageIdCollision`    | error    | Distinct IDs mangle to the same identifier on a platform, such as `fooBar` / `foo_bar`.  |
| `unknown-variable`        | `UnknownVariable`       | error    | A translation reads a variable its source message doesn't.                               |
| `selector-mismatch`       | `SelectorMismatch`      | error    | A translation selects on a variable through a different function than its source.        |
| `missing-variable`        | `MissingVariable`       | warning  | A translation never reads one of its source's parameters.                                |
| `missing-plural-category` | `MissingPluralCategory` | warning  | A plural selector has no variant for some of the target locale's CLDR plural categories. |
| `stale-translation`       | `StaleTranslation`      | warning  | The source message changed after it was translated (its `sourceHash` differs).           |
| `extra-translation`       | `ExtraTranslation`      | warning  | A translation's message is no longer in the source.                                      |
| `missing-translation`     | `MissingTranslation`    | warning  | A locale has no translation of a message (not reported for `doNotTranslate` messages).   |

A config that doesn't decode fails the load with `ConfigError`, a module that doesn't load with `ModuleLoadError` (with its line and column when the runtime gives them), and a malformed translation file with `TranslationFileError`.
