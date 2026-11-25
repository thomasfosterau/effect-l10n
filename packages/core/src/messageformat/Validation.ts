/**
 * Semantic validation: the spec's data model errors, plus effect-l10n's lint
 * warnings, as {@link Diagnostic} values. Checks run to completion and
 * collect every finding rather than stopping at the first.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as HashSet from "effect/HashSet";
import * as Option from "effect/Option";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as DataModel from "./DataModel";
import { placeholders } from "./internal/patterns";
import {
  DuplicateDeclaration,
  DuplicateVariant,
  MessageFormatError,
  MissingFallbackVariant,
  MissingSelectorAnnotation,
  Reason,
  UnreachableVariant,
  UnusedLocal,
  VariantKeyMismatch,
} from "./MessageFormatError";
import { functionOf } from "./internal/declarations";

/**
 * One finding: an `error` makes the message invalid, a `warning` is lint.
 *
 * @category diagnostics
 * @since 0.1.0
 */
export class Diagnostic extends Schema.Class<Diagnostic, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/messageformat/Diagnostic",
)({ severity: Schema.Literals(["error", "warning"]), reason: Reason }) {
  /** The finding's code, as listed in `Reason`. */
  get code(): Reason["code"] {
    return this.reason.code;
  }
  get message(): string {
    return this.reason.message;
  }
  get span(): Option.Option<DataModel.Span> {
    return Option.fromUndefinedOr(this.reason.span);
  }
}

/**
 * What the lint checks need to know. Without a `locale`, the
 * `unreachable-variant` check is skipped.
 *
 * @category diagnostics
 * @since 0.1.0
 */
export interface Options {
  readonly locale?: string;
}

const error = (reason: Reason): Diagnostic => new Diagnostic({ severity: "error", reason });
const warning = (reason: Reason): Diagnostic => new Diagnostic({ severity: "warning", reason });

const spanOf = (node: { readonly span?: DataModel.Span }) =>
  node.span === undefined ? {} : { span: node.span };

/** The variables an expression or markup reads: its operand and option values. */
const variablesIn = (node: DataModel.Expression | DataModel.Markup): Array<string> => {
  const options = node.type === "markup" ? node.options : (node.function?.options ?? {});
  const operand = node.type === "expression" && "arg" in node ? [node.arg] : [];
  return Arr.filterMap([...operand, ...R.values(options)], (value) =>
    value.type === "variable" ? Result.succeed(value.name) : Result.failVoid,
  );
};

/** Every variable the message reads, outside each declaration's own name. */
const usedVariables = (message: DataModel.Message): HashSet.HashSet<string> =>
  HashSet.fromIterable([
    ...Arr.flatMap(message.declarations, (declaration) =>
      declaration.type === "input"
        ? Arr.drop(variablesIn(declaration.value), 1)
        : variablesIn(declaration.value),
    ),
    ...(message.type === "select" ? Arr.map(message.selectors, (s) => s.name) : []),
    ...Arr.flatMap(placeholders(message), variablesIn),
  ]);

/**
 * Duplicate Declaration: a name declared twice, or declared after an earlier
 * declaration (or its own value) used it.
 */
const checkDeclarations = (message: DataModel.Message): Array<Diagnostic> =>
  Arr.reduce(
    message.declarations,
    { seen: HashSet.empty<string>(), diagnostics: Arr.empty<Diagnostic>() },
    ({ seen, diagnostics }, declaration) => {
      const reads =
        declaration.type === "input"
          ? Arr.drop(variablesIn(declaration.value), 1)
          : variablesIn(declaration.value);
      const duplicate =
        HashSet.has(seen, declaration.name) || Arr.contains(reads, declaration.name);
      return {
        seen: HashSet.union(seen, HashSet.fromIterable([...reads, declaration.name])),
        diagnostics: duplicate
          ? [
              ...diagnostics,
              error(
                new DuplicateDeclaration({ ...spanOf(declaration), variable: declaration.name }),
              ),
            ]
          : diagnostics,
      };
    },
  ).diagnostics;

const keyId = (key: DataModel.Key): string =>
  key.type === "*" ? "*" : `=${key.value.normalize("NFC")}`;

const checkVariants = (message: DataModel.SelectMessage): Array<Diagnostic> => {
  const selectors = message.selectors.length;
  const mismatches = Arr.filterMap(message.variants, (variant) =>
    variant.keys.length === selectors
      ? Result.failVoid
      : Result.succeed(
          error(
            new VariantKeyMismatch({ ...spanOf(variant), keys: variant.keys.length, selectors }),
          ),
        ),
  );
  const fallback = Arr.some(message.variants, (variant) =>
    Arr.every(variant.keys, (key) => key.type === "*"),
  )
    ? []
    : [error(new MissingFallbackVariant(spanOf(message)))];
  const groups = Arr.groupBy(message.variants, (variant) =>
    Arr.join(Arr.map(variant.keys, keyId), "\u0000"),
  );
  const duplicates = Arr.flatMap(R.values(groups), (group) =>
    Arr.map(Arr.drop(group, 1), (variant) => error(new DuplicateVariant(spanOf(variant)))),
  );
  return [...mismatches, ...fallback, ...duplicates];
};

const checkSelectors = (message: DataModel.SelectMessage): Array<Diagnostic> =>
  Arr.filterMap(message.selectors, (selector) =>
    Option.isSome(functionOf(message, selector.name))
      ? Result.failVoid
      : Result.succeed(
          error(new MissingSelectorAnnotation({ ...spanOf(selector), variable: selector.name })),
        ),
  );

const checkUnusedLocals = (message: DataModel.Message): Array<Diagnostic> => {
  const used = usedVariables(message);
  return Arr.filterMap(message.declarations, (declaration) =>
    declaration.type === "local" && !HashSet.has(used, declaration.name)
      ? Result.succeed(
          warning(new UnusedLocal({ ...spanOf(declaration), variable: declaration.name })),
        )
      : Result.failVoid,
  );
};

const isNumberLiteral = (value: string): boolean =>
  /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(value);

/** The plural categories a selector can produce, if it selects by plural rules. */
const pluralCategories = (
  message: DataModel.SelectMessage,
  selector: DataModel.VariableRef,
  locale: string,
): Option.Option<ReadonlyArray<string>> =>
  Option.flatMap(functionOf(message, selector.name), (fn) => {
    if (fn.name !== "number" && fn.name !== "integer") return Option.none();
    const select = fn.options["select"];
    const type = select?.type === "literal" ? select.value : "plural";
    if (type !== "plural" && type !== "ordinal") return Option.none();
    // An unknown locale makes `Intl` throw; the check is then skipped.
    return Result.getSuccess(
      Result.try(
        () =>
          new Intl.PluralRules(locale, {
            type: type === "plural" ? "cardinal" : "ordinal",
          }).resolvedOptions().pluralCategories,
      ),
    );
  });

const checkPluralKeys = (message: DataModel.SelectMessage, locale: string): Array<Diagnostic> =>
  Arr.flatMap(message.selectors, (selector, index) =>
    Option.match(pluralCategories(message, selector, locale), {
      onNone: () => [],
      onSome: (categories) =>
        Arr.filterMap(message.variants, (variant) => {
          const key = variant.keys[index];
          return key?.type === "literal" &&
            !isNumberLiteral(key.value) &&
            !Arr.contains(categories, key.value)
            ? Result.succeed(
                warning(new UnreachableVariant({ ...spanOf(key), key: key.value, locale })),
              )
            : Result.failVoid;
        }),
    }),
  );

/**
 * Every data model error and lint warning in a message, in source order
 * within each check.
 *
 * @category validation
 * @since 0.1.0
 */
export const check = (
  message: DataModel.Message,
  options: Options = {},
): ReadonlyArray<Diagnostic> => [
  ...checkDeclarations(message),
  ...(message.type === "select"
    ? [
        ...checkSelectors(message),
        ...checkVariants(message),
        ...(options.locale === undefined ? [] : checkPluralKeys(message, options.locale)),
      ]
    : []),
  ...checkUnusedLocals(message),
];

/**
 * The message if it has no data model errors, or the first of them.
 * Warnings don't fail it.
 *
 * @category validation
 * @since 0.1.0
 */
export const validateResult = (
  message: DataModel.Message,
): Result.Result<DataModel.Message, MessageFormatError> =>
  Option.match(
    Arr.findFirst(check(message), (diagnostic) => diagnostic.severity === "error"),
    {
      onNone: () => Result.succeed(message),
      onSome: (diagnostic) => Result.fail(new MessageFormatError({ reason: diagnostic.reason })),
    },
  );

/**
 * Fails with a `MessageFormatError` for the message's first data model error.
 *
 * @category validation
 * @since 0.1.0
 */
export const validate = (
  message: DataModel.Message,
): Effect.Effect<DataModel.Message, MessageFormatError> =>
  Effect.fromResult(validateResult(message));
