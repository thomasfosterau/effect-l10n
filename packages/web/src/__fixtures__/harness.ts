// Compiles messages from MessageFormat sources with the web target, writes
// the output to a temporary directory and imports it, for the tests.
import * as Ir from "@thomasfosterau/effect-l10n/compiler/Ir";
import * as Lowering from "@thomasfosterau/effect-l10n/compiler/Lowering";
import type * as Target from "@thomasfosterau/effect-l10n/compiler/Target";
import { Locale } from "@thomasfosterau/effect-l10n/Locale";
import { params } from "@thomasfosterau/effect-l10n/messageformat/Params";
import { parse } from "@thomasfosterau/effect-l10n/messageformat/Parser";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import { Options, target } from "../WebTarget";

/** A formatted part, as the emitted `.parts()` returns it. */
export type Part = R.ReadonlyRecord<string, unknown>;

/** A compiled message, as the emitted module exports it. */
export interface Compiled {
  (params?: R.ReadonlyRecord<string, unknown>, options?: R.ReadonlyRecord<string, unknown>): string;
  readonly parts: (
    params?: R.ReadonlyRecord<string, unknown>,
    options?: R.ReadonlyRecord<string, unknown>,
  ) => ReadonlyArray<Part>;
}

export class ImportFailed extends Schema.TaggedError<
  ImportFailed,
  { readonly brand: unique symbol }
>()("ImportFailed", { file: Schema.String, cause: Schema.Unknown }) {}

const tag = Schema.decodeSync(Locale);

/** A message to compile: its ID, its source in each locale, and its metadata. */
export interface Source {
  readonly id: string;
  readonly locales: R.ReadonlyRecord<string, string>;
  readonly description?: string;
}

/** The IR of a message whose first locale is its source. */
const irMessage = Effect.fn("irMessage")(function* (source: Source) {
  const models = yield* Effect.all(
    R.map(source.locales, (text) => parse(text)),
    {
      concurrency: 1,
    },
  );
  const first = yield* Effect.fromOption(Arr.head(R.values(models)));
  return new Ir.Message({
    id: source.id,
    doNotTranslate: false,
    ...R.getSomes({ description: Option.fromUndefinedOr(source.description) }),
    params: Arr.map(params(first), (p) => new Ir.Param(p)),
    locales: R.map(
      models,
      (message, locale) =>
        new Ir.LocaleMessage({
          locale: tag(locale),
          from: tag(locale),
          source: source.locales[locale] ?? "",
          message,
        }),
    ),
  });
});

/** A lowered project of messages, its locales in first-seen order. */
const project = Effect.fn("project")(function* (sources: ReadonlyArray<Source>) {
  const messages = yield* Effect.forEach(
    sources,
    (s) => Effect.map(irMessage(s), (ir) => Lowering.lowerMessage(ir, target)[0]),
    { concurrency: 1 },
  );
  const locales = Arr.dedupe(Arr.flatMap(sources, (s) => R.keys(s.locales)));
  return new Lowering.Project({
    target: "web",
    sourceLocale: tag(locales[0] ?? "en"),
    locales: Arr.map(locales, (l) => tag(l)),
    messages,
  });
});

/** Compiles messages with the given options to the web target's files. */
export const emit = Effect.fn("emit")(function* (
  sources: ReadonlyArray<Source>,
  options: typeof Options.Encoded = {},
) {
  const decoded = yield* Schema.decodeEffect(Options)(options);
  return yield* target.emit(yield* project(sources), decoded);
});

/** Writes a file tree to a fresh temporary directory, returning its path. */
export const writeTree = Effect.fn("writeTree")(function* (files: Target.FileTree) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped();
  yield* Effect.forEach(
    R.toEntries(files),
    ([file, text]) =>
      fs
        .makeDirectory(path.dirname(path.join(dir, file)), { recursive: true })
        .pipe(Effect.andThen(fs.writeFileString(path.join(dir, file), text))),
    { concurrency: 1, discard: true },
  );
  return dir;
});

/** Imports an emitted module. */
export const importFrom = <A>(file: string) =>
  Effect.tryPromise({
    try: (): Promise<A> => import(/* @vite-ignore */ file),
    catch: (cause) => new ImportFailed({ file, cause }),
  });

/** Compiles, writes and imports the messages barrel. */
export const load = Effect.fn("load")(function* (
  sources: ReadonlyArray<Source>,
  options: typeof Options.Encoded = {},
) {
  const path = yield* Path.Path;
  const dir = yield* writeTree(yield* emit(sources, options));
  const messages = yield* importFrom<R.ReadonlyRecord<string, Compiled>>(
    path.join(dir, "messages.js"),
  );
  return { dir, messages };
});
