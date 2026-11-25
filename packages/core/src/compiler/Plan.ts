/**
 * A message's selection as a decision tree: a `Switch` per selector, tried
 * in the order its function prefers the keys, a `Chain` that falls through
 * to the next plan when one matches nothing, and a `Leaf` pattern. Lowering
 * rewrites plans; targets read them to emit native resources or accessors.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { optionalKey } from "../internal/optional";
import * as DataModel from "../messageformat/DataModel";
import { functionOf, selectionKind } from "../messageformat/internal/declarations";

/**
 * How a `Switch`'s function compares its keys: `plural` and `ordinal`
 * match CLDR categories and exact numbers, `exact` only exact numbers, and
 * `other` whatever its function decides (such as `:string`).
 *
 * @category models
 * @since 0.1.0
 */
export const Kind = Schema.Literals(["plural", "ordinal", "exact", "other"]);

/**
 * @category models
 * @since 0.1.0
 */
export type Kind = typeof Kind.Type;

/**
 * Where a `Switch` is decided: in the target's native `resource` (such as
 * Android `<plurals>`), or in the generated `accessor` code.
 *
 * @category models
 * @since 0.1.0
 */
export const Placement = Schema.Literals(["resource", "accessor"]);

/**
 * @category models
 * @since 0.1.0
 */
export type Placement = typeof Placement.Type;

/**
 * A plan, as `Leaf`, `Switch` or `Chain`.
 *
 * @category models
 * @since 0.1.0
 */
export type Plan = Leaf | Switch | Chain;

/**
 * A plan's JSON form.
 *
 * @category models
 * @since 0.1.0
 */
export type Encoded =
  | { readonly _tag: "Leaf"; readonly pattern: typeof DataModel.Pattern.Encoded }
  | {
      readonly _tag: "Switch";
      readonly selector: string;
      readonly function: string;
      readonly kind: Kind;
      readonly at: Placement;
      readonly cases: ReadonlyArray<{ readonly key: string; readonly plan: Encoded }>;
      readonly otherwise?: Encoded;
    }
  | { readonly _tag: "Chain"; readonly plans: readonly [Encoded, ...Array<Encoded>] };

const PlanRef = Schema.suspend((): Schema.Codec<Plan, Encoded> => Plan);

/**
 * A pattern to format.
 *
 * @category models
 * @since 0.1.0
 */
export class Leaf extends Schema.TaggedClass<Leaf, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/compiler/Plan/Leaf",
)("Leaf", { pattern: DataModel.Pattern }) {}

/**
 * One key of a `Switch` and the plan it leads to.
 *
 * @category models
 * @since 0.1.0
 */
export class Case extends Schema.Class<Case, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/compiler/Plan/Case",
)({ key: Schema.String, plan: PlanRef }) {}

/**
 * Selects on `selector`, a variable of the message: its function orders the
 * case keys it matches, best first, and the first case whose plan matches
 * wins; then `otherwise`, the `*` key.
 *
 * @category models
 * @since 0.1.0
 */
export class Switch extends Schema.TaggedClass<Switch, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/compiler/Plan/Switch",
)("Switch", {
  selector: Schema.String,
  /** The selector's function, such as `integer`. */
  function: Schema.String,
  kind: Kind,
  at: Placement,
  cases: Schema.Array(Case),
  otherwise: Schema.optionalKey(PlanRef),
}) {}

/**
 * The first of `plans` that matches.
 *
 * @category models
 * @since 0.1.0
 */
export class Chain extends Schema.TaggedClass<Chain, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/compiler/Plan/Chain",
)("Chain", { plans: Schema.NonEmptyArray(PlanRef) }) {}

/**
 * The plan schema.
 *
 * @category schemas
 * @since 0.1.0
 */
export const Plan: Schema.Codec<Plan, Encoded> = Schema.Union([Leaf, Switch, Chain]);

/** A selector's function name and kind. */
const selectorOf = (message: DataModel.SelectMessage, name: string) =>
  Option.match(functionOf(message, name), {
    onNone: () => ({ function: "", kind: "other" as const }),
    onSome: (fn) => ({ function: fn.name, kind: selectionKind(fn) }),
  });

const build = (
  message: DataModel.SelectMessage,
  variants: ReadonlyArray<DataModel.Variant>,
  depth: number,
): Option.Option<Plan> => {
  const selector = message.selectors[depth];
  if (selector === undefined) {
    return Option.map(Arr.head(variants), (variant) => new Leaf({ pattern: variant.value }));
  }
  if (!Arr.isReadonlyArrayNonEmpty(variants)) return Option.none();
  const keyOf = (variant: DataModel.Variant) => variant.keys[depth];
  const literals = Arr.dedupe(
    Arr.filterMap(variants, (variant) => {
      const key = keyOf(variant);
      return key?.type === "literal" ? Result.succeed(key.value) : Result.failVoid;
    }),
  );
  const cases = Arr.getSomes(
    Arr.map(literals, (key) =>
      Option.map(
        build(
          message,
          Arr.filter(variants, (v) => {
            const k = keyOf(v);
            return k?.type === "literal" && k.value === key;
          }),
          depth + 1,
        ),
        (p) => new Case({ key, plan: p }),
      ),
    ),
  );
  const otherwise = build(
    message,
    Arr.filter(variants, (v) => keyOf(v)?.type === "*"),
    depth + 1,
  );
  return Option.some(
    new Switch({
      selector: selector.name,
      ...selectorOf(message, selector.name),
      at: "resource",
      cases,
      ...optionalKey("otherwise", otherwise),
    }),
  );
};

/**
 * A message's plan: a `Leaf` for a pattern message, and for a `.match` one
 * `Switch` per selector, in selector order, each `resource`-placed. It
 * selects exactly as the message does.
 *
 * @category constructors
 * @since 0.1.0
 */
export const fromMessage = (message: DataModel.Message): Plan =>
  message.type === "message"
    ? new Leaf({ pattern: message.pattern })
    : Option.getOrElse(build(message, message.variants, 0), () => new Leaf({ pattern: [] }));

/**
 * The keys a selector matches among `keys`, best first; none for keys it
 * can't match.
 *
 * @category evaluation
 * @since 0.1.0
 */
export type Matcher = (selector: Switch, keys: ReadonlyArray<string>) => ReadonlyArray<string>;

/**
 * The pattern a plan selects, given how its selectors match: the reference
 * semantics every target's resources and accessors must agree with. None
 * when nothing matches, which a complete plan never does.
 *
 * @category evaluation
 * @since 0.1.0
 */
export const evaluate = (plan: Plan, matches: Matcher): Option.Option<DataModel.Pattern> =>
  Match.valueTags(plan, {
    Leaf: (leaf) => Option.some(leaf.pattern),
    Chain: (chain) =>
      Arr.reduce(chain.plans, Option.none<DataModel.Pattern>(), (found, next) =>
        Option.orElse(found, () => evaluate(next, matches)),
      ),
    Switch: (node) => {
      const keys = Arr.map(node.cases, (c) => c.key);
      const chosen = Arr.reduce(
        matches(node, keys),
        Option.none<DataModel.Pattern>(),
        (found, key) =>
          Option.orElse(found, () =>
            Option.flatMap(
              Arr.findFirst(node.cases, (c) => c.key === key),
              (c) => evaluate(c.plan, matches),
            ),
          ),
      );
      return Option.orElse(chosen, () =>
        node.otherwise === undefined ? Option.none() : evaluate(node.otherwise, matches),
      );
    },
  });

/**
 * Every pattern a plan can produce, in order.
 *
 * @category traversal
 * @since 0.1.0
 */
export const leaves = (plan: Plan): ReadonlyArray<DataModel.Pattern> =>
  Match.valueTags(plan, {
    Leaf: (leaf) => [leaf.pattern],
    Chain: (chain) => Arr.flatMap(chain.plans, leaves),
    Switch: (node) => [
      ...Arr.flatMap(node.cases, (c) => leaves(c.plan)),
      ...(node.otherwise === undefined ? [] : leaves(node.otherwise)),
    ],
  });

/**
 * Applies `f` to every pattern of a plan.
 *
 * @category traversal
 * @since 0.1.0
 */
export const mapLeaves = (plan: Plan, f: (pattern: DataModel.Pattern) => DataModel.Pattern): Plan =>
  Match.valueTags(plan, {
    Leaf: (leaf) => new Leaf({ pattern: f(leaf.pattern) }),
    Chain: (chain) => new Chain({ plans: Arr.map(chain.plans, (p) => mapLeaves(p, f)) }),
    Switch: (node) =>
      new Switch({
        selector: node.selector,
        function: node.function,
        kind: node.kind,
        at: node.at,
        cases: Arr.map(node.cases, (c) => new Case({ key: c.key, plan: mapLeaves(c.plan, f) })),
        ...optionalKey(
          "otherwise",
          Option.map(Option.fromUndefinedOr(node.otherwise), (o) => mapLeaves(o, f)),
        ),
      }),
  });
