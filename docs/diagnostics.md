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

The parser reports `duplicate-option-name` because the data model's options are a record, which can't hold a duplicate. A variable declared twice is always `duplicate-declaration`, so there's no separate shadowing warning.
