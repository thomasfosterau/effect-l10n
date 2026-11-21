/**
 * Catalogs: modules whose exports are messages. Each message's ID is its
 * export path (`checkout.total` for `total` inside an exported `checkout`
 * object) unless it sets `id`. Catalog files merge into one namespace, so
 * the same ID in two files is a duplicate.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import {
  type Diagnostic,
  DuplicateMessageId,
  InvalidMessageId,
  MessageIdCollision,
  report,
  type Severity,
} from "./Diagnostic";
import { isMessage, type Message } from "./Message";

const idPattern = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/;

/**
 * A message ID: dot-separated identifiers that are valid Swift, Kotlin and
 * Android resource names once mangled, such as `checkout.totalPrice`.
 *
 * @category schemas
 * @since 0.1.0
 */
export const MessageId = Schema.String.check(Schema.isPattern(idPattern)).pipe(
  Schema.brand("MessageId"),
);

/**
 * @category schemas
 * @since 0.1.0
 */
export type MessageId = typeof MessageId.Type;

/**
 * Messages and namespaces of messages.
 *
 * @category models
 * @since 0.1.0
 */
export interface Tree {
  readonly [key: string]: Message | Tree;
}

/**
 * Declares a catalog: the same object, typed. Exporting messages from a
 * module works as well.
 *
 * @category constructors
 * @since 0.1.0
 */
export const make = <const T extends Tree>(tree: T): T => tree;

/**
 * A message found in a catalog, with its ID and the file it came from.
 *
 * @category models
 * @since 0.1.0
 */
export interface Entry {
  readonly id: string;
  readonly message: Message;
  readonly file: Option.Option<string>;
}

/** A value a module exports. */
type Exported = R.ReadonlyRecord<string, unknown>[string];

const walk = (
  value: Exported,
  path: ReadonlyArray<string>,
  file: Option.Option<string>,
): ReadonlyArray<Entry> => {
  if (isMessage(value)) return [{ id: value.id ?? Arr.join(path, "."), message: value, file }];
  if (!P.isObject(value)) return [];
  return Arr.flatMap(R.toEntries(value), ([key, child]) => walk(child, [...path, key], file));
};

/**
 * The messages a catalog module exports, nested objects as namespaces. A
 * `default` export that is a {@link Tree} is read as the module's root.
 *
 * @category loading
 * @since 0.1.0
 */
export const entries = (
  exports: R.ReadonlyRecord<string, unknown>,
  file: Option.Option<string> = Option.none(),
): ReadonlyArray<Entry> =>
  Arr.flatMap(R.toEntries(exports), ([key, value]) =>
    walk(value, key === "default" && !isMessage(value) ? [] : [key], file),
  );

/**
 * A platform whose identifiers message IDs are mangled into.
 *
 * @category identifiers
 * @since 0.1.0
 */
export type Platform = "android" | "swift" | "kotlin";

/**
 * A message ID's identifier on a platform: an Android resource name in
 * `snake_case` with namespaces joined by `_` (`checkout_total_price`), or
 * Swift and Kotlin `camelCase` members of nested namespaces
 * (`checkout.totalPrice`).
 *
 * @category identifiers
 * @since 0.1.0
 */
export const identifierOf = (id: string, platform: Platform): string => {
  const segments = Str.split(id, ".");
  return platform === "android"
    ? Arr.join(Arr.map(segments, Str.snakeCase), "_")
    : Arr.join(Arr.map(segments, Str.camelCase), ".");
};

const platforms: ReadonlyArray<Platform> = ["android", "swift", "kotlin"];

const isMessageId = Schema.is(MessageId);

const location = (entry: Entry) =>
  Option.match(entry.file, {
    onNone: () => ({ messageId: entry.id }),
    onSome: (file) => ({ messageId: entry.id, file }),
  });

/**
 * Every invalid, duplicate or colliding ID among a project's messages.
 *
 * @category diagnostics
 * @since 0.1.0
 */
export const check = (
  all: ReadonlyArray<Entry>,
  overrides: R.ReadonlyRecord<string, Severity> = {},
): ReadonlyArray<Diagnostic> => {
  const invalid = Arr.filterMap(all, (entry) =>
    isMessageId(entry.id)
      ? Result.failVoid
      : Result.succeed(
          report(overrides, "error", new InvalidMessageId({ id: entry.id }), location(entry)),
        ),
  );
  const byId = Arr.groupBy(all, (entry) => entry.id);
  const duplicates = Arr.filterMap(R.toEntries(byId), ([id, group]) =>
    group.length > 1
      ? Result.succeed(
          report(
            overrides,
            "error",
            new DuplicateMessageId({ id, files: Arr.getSomes(Arr.map(group, (e) => e.file)) }),
            { messageId: id },
          ),
        )
      : Result.failVoid,
  );
  const valid = Arr.filter(R.keys(byId), isMessageId);
  const collisions = Arr.flatMap(platforms, (platform) =>
    Arr.filterMap(
      R.toEntries(Arr.groupBy(valid, (id) => identifierOf(id, platform))),
      ([identifier, ids]) =>
        ids.length > 1
          ? Result.succeed(
              report(overrides, "error", new MessageIdCollision({ platform, identifier, ids })),
            )
          : Result.failVoid,
    ),
  );
  return Arr.getSomes([...invalid, ...duplicates, ...collisions]);
};
