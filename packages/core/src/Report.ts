/**
 * Diagnostics placed in their files and rendered: as plain-text code
 * frames, as JSON, or as GitHub Actions annotations. A MessageFormat 2 span
 * is mapped back through the string literal that holds the message, so it
 * points at the right line and column of a catalog or translation file.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { Diagnostic } from "./Diagnostic";
import { Span } from "./messageformat/DataModel";
import { optionalKey } from "./internal/optional";
import type { Project } from "./Project";

/**
 * A 1-based line and column, in UTF-16 code units.
 *
 * @category models
 * @since 0.1.0
 */
export class Position extends Schema.Class<Position, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/Report/Position",
)({ line: Schema.Int, column: Schema.Int }) {}

/**
 * A diagnostic and where it is: its file, the range it covers there when
 * that is known, and the lines of that range for a code frame.
 *
 * @category models
 * @since 0.1.0
 */
export class Located extends Schema.Class<Located, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/Report/Located",
)({
  diagnostic: Diagnostic,
  start: Schema.optionalKey(Position),
  end: Schema.optionalKey(Position),
  /** The file's lines from `start` to `end`. */
  excerpt: Schema.Array(Schema.String),
}) {}

const JsonString = Schema.fromJsonString(Schema.String);

const TranslationJson = Schema.fromJsonString(
  Schema.Struct({ messages: Schema.Record(Schema.String, Schema.String) }),
);

const isSpan = Schema.is(Span);

const isFound = (index: number) => index >= 0;

/** How a string literal of each kind writes `text`, quotes included. */
const encodings: ReadonlyArray<(text: string) => string> = [
  (text) => `\`${text.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${")}\``,
  (text) => Schema.encodeSync(JsonString)(text),
  (text) =>
    `'${text
      .replaceAll("\\", "\\\\")
      .replaceAll("'", "\\'")
      .replaceAll("\n", "\\n")
      .replaceAll("\r", "\\r")
      .replaceAll("\t", "\\t")}'`,
];

/**
 * Where `offset` of the MessageFormat source `source` is in `text`, the file
 * that holds it as a whole string literal: searched from the first mention
 * of `near` (such as the message's name), if any.
 *
 * @category locating
 * @since 0.1.0
 */
export const offsetIn = (
  text: string,
  source: string,
  offset: number,
  near = "",
): Option.Option<number> => {
  const from = Math.max(0, text.indexOf(near));
  const found = (literal: string) =>
    Option.orElse(Option.liftPredicate(text.indexOf(literal, from), isFound), () =>
      Option.liftPredicate(text.indexOf(literal), isFound),
    );
  // The prefix's literal, less its closing quote, ends where `offset` is.
  return Arr.findFirst(encodings, (encode) =>
    Option.map(
      found(encode(source)),
      (start) => start + encode(source.slice(0, offset)).length - 1,
    ),
  );
};

/**
 * The 1-based position of `offset` in `text`.
 *
 * @category locating
 * @since 0.1.0
 */
export const positionOf = (text: string, offset: number): Position => {
  const before = text.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;
  return new Position({
    line: Str.split(before, "\n").length,
    column: offset - lineStart + 1,
  });
};

/** The MessageFormat source a diagnostic is about, read from the project or its file. */
const sourceOf = (project: Project, diagnostic: Diagnostic, text: string) =>
  Option.flatMap(Option.fromUndefinedOr(diagnostic.messageId), (id) =>
    diagnostic.locale === undefined || diagnostic.locale === project.sourceLocale
      ? Option.map(
          Arr.findFirst(project.messages, (m) => m.id === id),
          (m) => m.message.source,
        )
      : Option.orElse(
          Option.map(
            Arr.findFirst(
              project.translations,
              (t) => t.messageId === id && t.locale === diagnostic.locale,
            ),
            (t) => t.source,
          ),
          () =>
            Option.flatMap(Schema.decodeOption(TranslationJson)(text), (file) =>
              R.get(file.messages, id),
            ),
        ),
  );

const spanOf = (diagnostic: Diagnostic): Option.Option<Span> =>
  P.hasProperty(diagnostic.reason, "span") && isSpan(diagnostic.reason.span)
    ? Option.some(diagnostic.reason.span)
    : Option.none();

/**
 * Places a diagnostic in its file, `root`-relative. It has no position when
 * its file can't be read or doesn't hold its message's source.
 *
 * @category locating
 * @since 0.1.0
 */
export const locate = Effect.fn("Report.locate")(function* (
  project: Project,
  diagnostic: Diagnostic,
  root = ".",
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const unplaced = new Located({ diagnostic, excerpt: [] });
  if (diagnostic.file === undefined) return unplaced;
  const text = yield* fs.readFileString(path.resolve(root, diagnostic.file)).pipe(Effect.option);
  return Option.getOrElse(
    Option.flatMap(text, (contents) =>
      Option.flatMap(sourceOf(project, diagnostic, contents), (source) => {
        const span = Option.getOrElse(spanOf(diagnostic), () => ({ start: 0, end: 0 }));
        const near = Option.getOrElse(
          Option.flatMap(Option.fromUndefinedOr(diagnostic.messageId), (id) =>
            Arr.last(Str.split(id, ".")),
          ),
          () => "",
        );
        return Option.map(
          Option.all([
            offsetIn(contents, source, span.start, near),
            offsetIn(contents, source, span.end, near),
          ]),
          ([start, end]) => {
            const from = positionOf(contents, start);
            const to = positionOf(contents, end);
            return new Located({
              diagnostic,
              start: from,
              end: to,
              excerpt: Arr.take(
                Arr.drop(Str.split(contents, "\n"), from.line - 1),
                to.line - from.line + 1,
              ),
            });
          },
        );
      }),
    ),
    () => unplaced,
  );
});

/**
 * {@link locate} for each of a project's diagnostics, or the ones given.
 *
 * @category locating
 * @since 0.1.0
 */
export const locateAll = (
  project: Project,
  diagnostics: ReadonlyArray<Diagnostic> = project.diagnostics,
  root = ".",
) => Effect.forEach(diagnostics, (d) => locate(project, d, root), { concurrency: 8 });

/**
 * A diagnostic's JSON form.
 *
 * @category rendering
 * @since 0.1.0
 */
export const JsonDiagnostic = Schema.Struct({
  severity: Schema.Literals(["error", "warning"]),
  code: Schema.String,
  message: Schema.String,
  file: Schema.optionalKey(Schema.String),
  messageId: Schema.optionalKey(Schema.String),
  locale: Schema.optionalKey(Schema.String),
  line: Schema.optionalKey(Schema.Int),
  column: Schema.optionalKey(Schema.Int),
  endLine: Schema.optionalKey(Schema.Int),
  endColumn: Schema.optionalKey(Schema.Int),
});

/**
 * @category rendering
 * @since 0.1.0
 */
export type JsonDiagnostic = typeof JsonDiagnostic.Type;

const JsonReport = Schema.fromJsonString(Schema.Array(JsonDiagnostic), { space: 2 });

const toJson = ({ diagnostic, start, end }: Located): JsonDiagnostic => ({
  severity: diagnostic.severity,
  code: diagnostic.code,
  message: diagnostic.message,
  ...optionalKey("file", Option.fromUndefinedOr(diagnostic.file)),
  ...optionalKey("messageId", Option.fromUndefinedOr(diagnostic.messageId)),
  ...optionalKey("locale", Option.fromUndefinedOr(diagnostic.locale)),
  ...optionalKey("line", Option.fromUndefinedOr(start?.line)),
  ...optionalKey("column", Option.fromUndefinedOr(start?.column)),
  ...optionalKey("endLine", Option.fromUndefinedOr(end?.line)),
  ...optionalKey("endColumn", Option.fromUndefinedOr(end?.column)),
});

/**
 * Renders diagnostics as a JSON array of {@link JsonDiagnostic}.
 *
 * @category rendering
 * @since 0.1.0
 */
export const json = (located: ReadonlyArray<Located>): string =>
  `${Schema.encodeSync(JsonReport)(Arr.map(located, toJson))}\n`;

const escapeData = (text: string) =>
  text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

const escapeProperty = (text: string) =>
  escapeData(text).replaceAll(":", "%3A").replaceAll(",", "%2C");

/**
 * Renders diagnostics as GitHub Actions workflow commands, one line each,
 * which annotate the file and line of each.
 *
 * @category rendering
 * @since 0.1.0
 */
export const github = (located: ReadonlyArray<Located>): string =>
  Arr.join(
    Arr.map(located, (l) => {
      const d = toJson(l);
      const properties = Arr.join(
        Arr.map(
          Arr.getSomes([
            Option.map(Option.fromUndefinedOr(d.file), (v) => `file=${v}`),
            Option.map(Option.fromUndefinedOr(d.line), (v) => `line=${v}`),
            Option.map(Option.fromUndefinedOr(d.column), (v) => `col=${v}`),
            Option.map(Option.fromUndefinedOr(d.endLine), (v) => `endLine=${v}`),
            Option.map(Option.fromUndefinedOr(d.endColumn), (v) => `endColumn=${v}`),
            Option.some(`title=${d.code}`),
          ]),
          escapeProperty,
        ),
        ",",
      );
      return `::${d.severity} ${properties}::${escapeData(where(l, d.message))}\n`;
    }),
    "",
  );

/** A message with the message ID and locale it is about. */
const where = ({ diagnostic }: Located, text: string) =>
  Option.match(Option.fromUndefinedOr(diagnostic.messageId), {
    onNone: () => text,
    onSome: (id) =>
      `${text} (${id}${diagnostic.locale === undefined ? "" : `, ${diagnostic.locale}`})`,
  });

const frame = (located: Located): ReadonlyArray<string> =>
  Option.match(
    Option.all([Option.fromUndefinedOr(located.start), Option.fromUndefinedOr(located.end)]),
    {
      onNone: () => [],
      onSome: ([start, end]) => {
        const width = String(end.line).length;
        const gutter = (label: string) => `${label.padStart(width)} | `;
        return [
          gutter(""),
          ...Arr.flatMap(located.excerpt, (line, i) => {
            const number = start.line + i;
            const from = number === start.line ? start.column : 1;
            const to = number === end.line ? end.column : line.length + 1;
            return [
              `${gutter(String(number))}${line}`,
              `${gutter("")}${" ".repeat(from - 1)}${"^".repeat(Math.max(1, to - from))}`,
            ];
          }),
        ];
      },
    },
  );

/**
 * Renders diagnostics as plain text, each with a code frame when its
 * position is known. No colours: a CLI adds them.
 *
 * @category rendering
 * @since 0.1.0
 */
export const text = (located: ReadonlyArray<Located>): string =>
  Arr.join(
    Arr.map(located, (l) => {
      const { diagnostic, start } = l;
      const at = Arr.fromOption(
        Option.map(
          Option.fromUndefinedOr(diagnostic.file),
          (file) => `  --> ${file}${start === undefined ? "" : `:${start.line}:${start.column}`}`,
        ),
      );
      return Arr.join(
        [
          `${diagnostic.severity}[${diagnostic.code}]: ${where(l, diagnostic.message)}`,
          ...at,
          ...Arr.map(frame(l), (line) => `  ${line}`.trimEnd()),
        ],
        "\n",
      );
    }),
    "\n\n",
  ) + (Arr.isReadonlyArrayEmpty(located) ? "" : "\n");
