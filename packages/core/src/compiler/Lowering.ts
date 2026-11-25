/**
 * Capability-aware lowering: rewrites each message's plan into what one
 * target can express. Selection a target's resources can't hold moves to
 * its accessors, plural selectors become one case per CLDR category,
 * unsupported functions are formatted ahead in the accessor, and markup is
 * kept or stripped. Every pass is pure and keeps the message's output.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Eq from "effect/Equal";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { optionalKey } from "../internal/optional";
import * as Struct from "effect/Struct";
import { type Diagnostic, report, type Severity, UnsupportedFeature } from "../Diagnostic";
import { Locale } from "../Locale";
import * as DataModel from "../messageformat/DataModel";
import { functionOf } from "../messageformat/internal/declarations";
import * as Ir from "./Ir";
import * as Plan from "./Plan";

/**
 * What a target expresses natively.
 *
 * - `selectors`: which `.match` selectors its resources hold: `any`,
 *   `plural` (CLDR plural categories only, as Android's `<plurals>`), or
 *   `none`.
 * - `maxSelectors`: how many resource selectors may nest; unbounded if
 *   absent.
 * - `hasExactKeys`: whether its resources hold exact-number keys such as `=0`.
 * - `functions`: the functions it formats natively, or `all`.
 * - `markup`: whether it `keep`s markup or `strip`s it.
 * - `hasAccessors`: whether it generates accessor code, which takes whatever
 *   its resources can't hold. Without one, that is an `unsupported-feature`.
 *
 * @category models
 * @since 0.1.0
 */
export const Capabilities = Schema.Struct({
  selectors: Schema.Literals(["any", "plural", "none"]),
  maxSelectors: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  hasExactKeys: Schema.Boolean,
  functions: Schema.Union([Schema.Literal("all"), Schema.Array(Schema.String)]),
  markup: Schema.Literals(["keep", "strip"]),
  hasAccessors: Schema.Boolean,
});

/**
 * @category models
 * @since 0.1.0
 */
export type Capabilities = typeof Capabilities.Type;

/**
 * An expression the accessor formats and passes to the resource as the
 * string parameter `name`.
 *
 * @category models
 * @since 0.1.0
 */
export class Preformat extends Schema.Class<Preformat, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/compiler/Preformat",
)({ name: Schema.String, expression: DataModel.Expression }) {}

/**
 * A message in one locale, lowered for a target: its declarations, which
 * its selectors and preformatted expressions read, its plan and what the
 * accessor formats ahead.
 *
 * @category models
 * @since 0.1.0
 */
export class Lowered extends Schema.Class<Lowered, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/compiler/Lowered",
)({
  locale: Locale,
  from: Locale,
  declarations: Schema.Array(DataModel.Declaration),
  plan: Plan.Plan,
  preformat: Schema.Array(Preformat),
}) {}

/**
 * A message lowered for a target, in every locale.
 *
 * @category models
 * @since 0.1.0
 */
export class Message extends Schema.Class<Message, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/compiler/LoweredMessage",
)({
  ...Struct.omit(Ir.Message.fields, ["locales"]),
  locales: Schema.Record(Schema.String, Lowered),
}) {}

/**
 * A project lowered for one target: what the target emits from.
 *
 * @category models
 * @since 0.1.0
 */
export class Project extends Schema.Class<Project, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/compiler/LoweredProject",
)({
  target: Schema.String,
  sourceLocale: Locale,
  locales: Schema.Array(Locale),
  messages: Schema.Array(Message),
}) {}

const cldrCategories: ReadonlyArray<string> = ["zero", "one", "two", "few", "many", "other"];

/** The locale's plural categories for a kind, in CLDR order. */
const categoriesOf = (locale: string, kind: Plan.Kind): ReadonlyArray<string> => {
  const found = new Intl.PluralRules(locale, {
    type: kind === "ordinal" ? "ordinal" : "cardinal",
  }).resolvedOptions().pluralCategories;
  return Arr.filter(cldrCategories, (c) => Arr.contains(found, c));
};

const withCases = (
  node: Plan.Switch,
  fields: Partial<Pick<Plan.Switch, "kind" | "at">>,
  cases: ReadonlyArray<Plan.Case>,
  otherwise: Option.Option<Plan.Plan>,
): Plan.Switch =>
  new Plan.Switch({
    selector: node.selector,
    function: node.function,
    kind: fields.kind ?? node.kind,
    at: fields.at ?? node.at,
    cases,
    ...Option.match(otherwise, { onNone: () => ({}), onSome: (o) => ({ otherwise: o }) }),
  });

const chainOf = (plans: ReadonlyArray<Plan.Plan>): Option.Option<Plan.Plan> =>
  Arr.match(plans, {
    onEmpty: () => Option.none(),
    onNonEmpty: (all) =>
      Option.some(all.length === 1 ? Arr.headNonEmpty(all) : new Plan.Chain({ plans: all })),
  });

/**
 * A plural `Switch` as a resource can hold it: one case per plural category
 * of `locale` (each falling through to `*`), after an `exact`-kind switch
 * for exact-number keys, if any. Categories the locale doesn't have are
 * unreachable and dropped.
 *
 * @category passes
 * @since 0.1.0
 */
export const expandCategories = (node: Plan.Switch, locale: string): Plan.Plan => {
  const otherwise = Option.fromUndefinedOr(node.otherwise);
  const exact = Arr.filter(node.cases, (c) => !Arr.contains(cldrCategories, c.key));
  const categories = Arr.getSomes(
    Arr.map(categoriesOf(locale, node.kind), (category) =>
      Option.map(
        chainOf([
          ...Option.toArray(
            Option.map(
              Arr.findFirst(node.cases, (c) => c.key === category),
              (c) => c.plan,
            ),
          ),
          ...Option.toArray(otherwise),
        ]),
        (p) => new Plan.Case({ key: category, plan: p }),
      ),
    ),
  );
  const byCategory = withCases(node, {}, categories, Option.none());
  return Arr.isReadonlyArrayNonEmpty(exact)
    ? new Plan.Chain({
        plans: [withCases(node, { kind: "exact" }, exact, Option.none()), byCategory],
      })
    : byCategory;
};

const isPlural = (kind: Plan.Kind) => kind === "plural" || kind === "ordinal";

const place = (
  plan: Plan.Plan,
  locale: string,
  capabilities: Capabilities,
  depth: number,
): Plan.Plan =>
  Match.valueTags(plan, {
    Leaf: (leaf): Plan.Plan => leaf,
    Chain: (c): Plan.Plan =>
      new Plan.Chain({ plans: Arr.map(c.plans, (p) => place(p, locale, capabilities, depth)) }),
    Switch: (node): Plan.Plan => {
      const room = capabilities.maxSelectors === undefined || depth < capabilities.maxSelectors;
      const placed = (at: Plan.Placement, s: Plan.Switch): Plan.Switch => {
        const next = at === "resource" ? depth + 1 : depth;
        return withCases(
          s,
          { at },
          Arr.map(
            s.cases,
            (c) => new Plan.Case({ key: c.key, plan: place(c.plan, locale, capabilities, next) }),
          ),
          Option.map(Option.fromUndefinedOr(s.otherwise), (o) =>
            place(o, locale, capabilities, next),
          ),
        );
      };
      if (capabilities.selectors === "any" && room) return placed("resource", node);
      if (capabilities.selectors !== "plural" || !room || !isPlural(node.kind)) {
        return placed("accessor", node);
      }
      const expanded = expandCategories(node, locale);
      return Match.valueTags(expanded, {
        Chain: (chain): Plan.Plan =>
          new Plan.Chain({
            plans: Arr.map(chain.plans, (s) =>
              s instanceof Plan.Switch
                ? placed(
                    s.kind === "exact" && !capabilities.hasExactKeys ? "accessor" : "resource",
                    s,
                  )
                : s,
            ),
          }),
        Switch: (s): Plan.Plan => placed("resource", s),
        Leaf: (leaf): Plan.Plan => leaf,
      });
    },
  });

/**
 * Places every `Switch` of a plan: in the resource when the target's
 * resources can hold it, otherwise in the accessor. Plural switches on a
 * `plural`-only target are expanded with {@link expandCategories}.
 *
 * @category passes
 * @since 0.1.0
 */
export const placeSelectors = (
  plan: Plan.Plan,
  locale: string,
  capabilities: Capabilities,
): Plan.Plan => place(plan, locale, capabilities, 0);

const isExpression = (part: DataModel.Pattern[number]): part is DataModel.Expression =>
  !P.isString(part) && part.type === "expression";

const functionName = (
  declarations: Pick<DataModel.Message, "declarations">,
  expression: DataModel.Expression,
): Option.Option<string> =>
  Option.map(
    Option.orElse(Option.fromUndefinedOr(expression.function), () =>
      expression instanceof DataModel.VariableExpression
        ? functionOf(declarations, expression.arg.name)
        : Option.none(),
    ),
    (fn) => fn.name,
  );

/** `_0`, `_1`, … skipping names the message already uses. */
const freshNames = (taken: ReadonlyArray<string>, count: number): ReadonlyArray<string> =>
  Arr.take(
    Arr.filter(
      Arr.map(Arr.range(0, count + taken.length), (i) => `_${i}`),
      (name) => !Arr.contains(taken, name),
    ),
    count,
  );

/**
 * Replaces each placeholder whose function the target doesn't format with a
 * string parameter the accessor formats ahead.
 *
 * @category passes
 * @since 0.1.0
 */
export const preformat = (
  plan: Plan.Plan,
  message: Pick<DataModel.Message, "declarations">,
  taken: ReadonlyArray<string>,
  capabilities: Capabilities,
): readonly [Plan.Plan, ReadonlyArray<Preformat>] => {
  const supported = capabilities.functions;
  if (supported === "all") return [plan, []];
  const unsupported = (expression: DataModel.Expression) =>
    Option.exists(functionName(message, expression), (name) => !Arr.contains(supported, name));
  const found = Arr.dedupeWith(
    Arr.filter(
      Arr.flatMap(Plan.leaves(plan), (p) => Arr.filter(p, isExpression)),
      unsupported,
    ),
    Eq.equals,
  );
  const names = freshNames(taken, found.length);
  const pre = Arr.zipWith(names, found, (name, expression) => new Preformat({ name, expression }));
  const rewritten = Plan.mapLeaves(plan, (pattern) =>
    Arr.map(pattern, (part) =>
      isExpression(part)
        ? Option.match(
            Arr.findFirst(pre, (p) => Eq.equals(p.expression, part)),
            {
              onNone: () => part,
              onSome: (p) =>
                new DataModel.VariableExpression({
                  arg: new DataModel.VariableRef({ name: p.name }),
                }),
            },
          )
        : part,
    ),
  );
  return [rewritten, pre];
};

/**
 * Removes markup from a plan's patterns.
 *
 * @category passes
 * @since 0.1.0
 */
export const stripMarkup = (plan: Plan.Plan): Plan.Plan =>
  Plan.mapLeaves(plan, (pattern) =>
    Arr.filter(pattern, (part) => P.isString(part) || part.type !== "markup"),
  );

const accessorSwitches = (plan: Plan.Plan): ReadonlyArray<Plan.Switch> =>
  Match.valueTags(plan, {
    Leaf: () => [],
    Chain: (c) => Arr.flatMap(c.plans, accessorSwitches),
    Switch: (s) => [
      ...(s.at === "accessor" ? [s] : []),
      ...Arr.flatMap(s.cases, (c) => accessorSwitches(c.plan)),
      ...(s.otherwise === undefined ? [] : accessorSwitches(s.otherwise)),
    ],
  });

/**
 * The target a project is lowered for.
 *
 * @category models
 * @since 0.1.0
 */
export interface TargetInfo {
  readonly name: string;
  readonly capabilities: Capabilities;
}

/**
 * Lowers one locale of a message: plans it, then places its selectors,
 * preformats and handles markup. Without an accessor, whatever needs one is
 * reported as `unsupported-feature`.
 *
 * @category lowering
 * @since 0.1.0
 */
export const lowerLocale = (
  message: Ir.Message,
  localized: Ir.LocaleMessage,
  target: TargetInfo,
  overrides: R.ReadonlyRecord<string, Severity> = {},
): readonly [Lowered, ReadonlyArray<Diagnostic>] => {
  const { capabilities } = target;
  const model = localized.message;
  const placed = placeSelectors(Plan.fromMessage(model), localized.locale, capabilities);
  const taken = [
    ...Arr.map(message.params, (p) => p.name),
    ...Arr.map(model.declarations, (d) => d.name),
  ];
  const [formatted, pre] = preformat(placed, model, taken, capabilities);
  const plan = capabilities.markup === "strip" ? stripMarkup(formatted) : formatted;
  const features = capabilities.hasAccessors
    ? []
    : [
        ...Arr.map(
          accessorSwitches(plan),
          (s) => `selection on $${s.selector}${s.function === "" ? "" : ` with :${s.function}`}`,
        ),
        ...Arr.filterMap(pre, (p) =>
          Option.match(functionName(model, p.expression), {
            onNone: () => Result.failVoid,
            onSome: (name) => Result.succeed(`:${name} formatting`),
          }),
        ),
      ];
  const location = {
    messageId: message.id,
    locale: localized.locale,
    ...optionalKey("file", Option.fromUndefinedOr(message.file)),
  };
  const diagnostics = Arr.getSomes(
    Arr.map(Arr.dedupe(features), (feature) =>
      report(
        overrides,
        "error",
        new UnsupportedFeature({ target: target.name, feature }),
        location,
      ),
    ),
  );
  return [
    new Lowered({
      locale: localized.locale,
      from: localized.from,
      declarations: model.declarations,
      plan,
      preformat: pre,
    }),
    diagnostics,
  ];
};

/**
 * Lowers a message in every locale.
 *
 * @category lowering
 * @since 0.1.0
 */
export const lowerMessage = (
  message: Ir.Message,
  target: TargetInfo,
  overrides: R.ReadonlyRecord<string, Severity> = {},
): readonly [Message, ReadonlyArray<Diagnostic>] => {
  const lowered = R.map(message.locales, (localized) =>
    lowerLocale(message, localized, target, overrides),
  );
  return [
    new Message({
      ...Struct.omit(message, ["locales"]),
      locales: R.map(lowered, ([l]) => l),
    }),
    Arr.flatMap(R.values(lowered), ([, d]) => d),
  ];
};

/**
 * Builds the lowered project from lowered messages, in the IR's order.
 *
 * @category lowering
 * @since 0.1.0
 */
export const project = (
  ir: Ir.Project,
  target: string,
  messages: ReadonlyArray<Message>,
): Project =>
  new Project({
    target,
    sourceLocale: ir.sourceLocale,
    locales: ir.locales,
    messages,
  });
