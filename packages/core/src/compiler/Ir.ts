/**
 * The compiler's platform-agnostic intermediate representation: every
 * message that parsed, with its parameters and metadata, resolved in every
 * locale along its fallback chain. Targets never see the raw project.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { optionalKey } from "../internal/optional";
import { Locale } from "../Locale";
import * as DataModel from "../messageformat/DataModel";
import { params } from "../messageformat/Params";
import type { Project as LoadedProject, ProjectMessage } from "../Project";
import { resolve } from "../Translation";

/**
 * A parameter of a message and the functions its source reads it through,
 * in the order they first appear.
 *
 * @category models
 * @since 0.1.0
 */
export class Param extends Schema.Class<Param, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/compiler/Param",
)({ name: Schema.String, functions: Schema.Array(Schema.String) }) {}

/**
 * A message in one locale: the translation the fallback chain chose, or the
 * source message. `from` is the locale whose text it is.
 *
 * @category models
 * @since 0.1.0
 */
export class LocaleMessage extends Schema.Class<LocaleMessage, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/compiler/LocaleMessage",
)({
  locale: Locale,
  from: Locale,
  source: Schema.String,
  message: DataModel.Message,
}) {}

/**
 * One message across the project: its ID, parameters, metadata for
 * translators and native resources, and its text in every locale.
 *
 * @category models
 * @since 0.1.0
 */
export class Message extends Schema.Class<Message, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/compiler/Message",
)({
  id: Schema.String,
  file: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  context: Schema.optionalKey(Schema.String),
  maxLength: Schema.optionalKey(Schema.Int),
  doNotTranslate: Schema.Boolean,
  params: Schema.Array(Param),
  /** By locale, in the project's locale order. */
  locales: Schema.Record(Schema.String, LocaleMessage),
}) {}

/**
 * The whole project, messages sorted by ID so every build sees them in the
 * same order.
 *
 * @category models
 * @since 0.1.0
 */
export class Project extends Schema.Class<Project, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/compiler/Project",
)({
  sourceLocale: Locale,
  locales: Schema.Array(Locale),
  messages: Schema.Array(Message),
}) {}

const byId = Order.mapInput(Order.String, (message: ProjectMessage) => message.id);

const metadata = ({ file, message }: ProjectMessage) => ({
  ...optionalKey("file", Option.fromUndefinedOr(file)),
  ...optionalKey("description", Option.fromUndefinedOr(message.description)),
  ...optionalKey("context", Option.fromUndefinedOr(message.context)),
  ...optionalKey("maxLength", Option.fromUndefinedOr(message.maxLength)),
});

const irMessage = (
  project: LoadedProject,
  message: ProjectMessage,
  model: DataModel.Message,
): Message => {
  const locales = R.fromEntries(
    Arr.map(project.locales, (locale): readonly [string, LocaleMessage] => {
      const chain = Option.getOrElse(R.get(project.fallbacks, locale), () => [locale]);
      const found = Option.filter(
        resolve(project.translations, message.id, chain),
        () => !(message.message.doNotTranslate ?? false),
      );
      return [
        locale,
        Option.match(found, {
          onNone: () =>
            new LocaleMessage({
              locale,
              from: project.sourceLocale,
              source: message.message.source,
              message: model,
            }),
          onSome: (t) =>
            new LocaleMessage({ locale, from: t.locale, source: t.source, message: t.message }),
        }),
      ];
    }),
  );
  return new Message({
    id: message.id,
    ...metadata(message),
    doNotTranslate: message.message.doNotTranslate ?? false,
    params: Arr.map(params(model), (p) => new Param(p)),
    locales,
  });
};

/**
 * The IR of a loaded project. Messages whose source didn't parse are left
 * out: the loader has already reported them. A translation that didn't
 * parse falls back like a missing one.
 *
 * @category constructors
 * @since 0.1.0
 */
export const fromProject = (project: LoadedProject): Project =>
  new Project({
    sourceLocale: project.sourceLocale,
    locales: project.locales,
    messages: Arr.filterMap(Arr.sort(project.messages, byId), (message) =>
      message.model === undefined
        ? Result.failVoid
        : Result.succeed(irMessage(project, message, message.model)),
    ),
  });
