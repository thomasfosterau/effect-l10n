// Lowered plans to JavaScript: each locale of a message becomes a function
// from a context and parameters to parts, calling the helpers in
// `internal.js`. Declarations are evaluated in order, so a variable is the
// constant its declaration binds.
import type * as Lowering from "@thomasfosterau/effect-l10n/compiler/Lowering";
import * as Plan from "@thomasfosterau/effect-l10n/compiler/Plan";
import type * as DataModel from "@thomasfosterau/effect-l10n/messageformat/DataModel";
import { fallbackOf } from "@thomasfosterau/effect-l10n/messageformat/Formatter";
import * as Arr from "effect/Array";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { functions } from "./format";

const JsonString = Schema.fromJsonString(Schema.String);

/** A JavaScript string literal. */
export const quote = (text: string): string => Schema.encodeSync(JsonString)(text);

const nfc = (name: string) => name.normalize("NFC");

/** Variables in scope: each declared name, NFC, to the constant holding its value. */
type Scope = R.ReadonlyRecord<string, string>;

const variable = (scope: Scope, name: string): string =>
  Option.getOrElse(R.get(scope, nfc(name)), () => `$param(c, p, ${quote(nfc(name))})`);

const optionCode = (scope: Scope, operand: DataModel.Operand): string =>
  operand.type === "literal"
    ? `[1, ${quote(operand.value)}]`
    : `[0, ${variable(scope, operand.name)}]`;

const optionsCode = (scope: Scope, options: DataModel.Options): string => {
  const entries = Arr.filter(R.toEntries(options), ([name]) => !Str.startsWith("u:")(name));
  return Arr.isReadonlyArrayEmpty(entries)
    ? "{}"
    : `{ ${Arr.join(
        Arr.map(entries, ([name, operand]) => `${quote(name)}: ${optionCode(scope, operand)}`),
        ", ",
      )} }`;
};

/** Trailing `u:dir` and `u:id` arguments, left out when unset. */
const annotations = (scope: Scope, options: DataModel.Options): string => {
  const dir = Option.map(R.get(options, "u:dir"), (o) => optionCode(scope, o));
  const id = Option.map(R.get(options, "u:id"), (o) => optionCode(scope, o));
  return Option.match(id, {
    onNone: () => Option.match(dir, { onNone: () => "", onSome: (d) => `, ${d}` }),
    onSome: (i) => `, ${Option.getOrElse(dir, () => "undefined")}, ${i}`,
  });
};

const definition = (name: string): string =>
  Arr.contains(functions, name) ? `$${name}` : "undefined";

/** An expression's value. */
const expressionCode = (scope: Scope, expression: DataModel.Expression): string => {
  const operand: Option.Option<string> =
    "arg" in expression
      ? Option.some(
          expression.arg.type === "literal"
            ? `$lit(${quote(expression.arg.value)})`
            : variable(scope, expression.arg.name),
        )
      : Option.none();
  const fn = expression.function;
  if (fn === undefined) return Option.getOrElse(operand, () => "undefined");
  return `$call(c, ${definition(fn.name)}, ${Option.getOrElse(operand, () => "undefined")}, ${optionsCode(
    scope,
    fn.options,
  )}, ${quote(fallbackOf(expression))}${annotations(scope, fn.options)})`;
};

/** Expressions lowering moved to fresh parameters, which the code formats in place. */
type Inlined = R.ReadonlyRecord<string, DataModel.Expression>;

const original = (inlined: Inlined, part: DataModel.Expression): DataModel.Expression =>
  "arg" in part && part.arg.type === "variable" && part.function === undefined
    ? Option.getOrElse(R.get(inlined, part.arg.name), () => part)
    : part;

const partCode = (scope: Scope, inlined: Inlined, part: DataModel.Pattern[number]): string => {
  if (P.isString(part)) return quote(part);
  if (part.type === "markup") {
    return `$mk(${quote(part.kind)}, ${quote(part.name)}, ${optionsCode(scope, part.options)}${Option.match(
      R.get(part.options, "u:id"),
      { onNone: () => "", onSome: (o) => `, ${optionCode(scope, o)}` },
    )})`;
  }
  const expression = original(inlined, part);
  return `$ph(c, ${expressionCode(scope, expression)}, ${quote(fallbackOf(expression))})`;
};

const thunk = (code: string) => `() => ${code}`;

/** A plan's parts, or `undefined` when nothing matches. */
const planCode = (scope: Scope, plan: Plan.Plan, inlined: Inlined = {}): string =>
  Match.valueTags(plan, {
    Leaf: (leaf) =>
      `$out([${Arr.join(
        Arr.map(leaf.pattern, (part) => partCode(scope, inlined, part)),
        ", ",
      )}])`,
    Chain: (chain) =>
      `$ch([${Arr.join(
        Arr.map(chain.plans, (p) => thunk(planCode(scope, p, inlined))),
        ", ",
      )}])`,
    Switch: (node) => {
      // The reference compares keys after NFC; the first case of a key wins.
      const cases = Arr.dedupeWith(
        Arr.map(node.cases, (c) => ({ key: nfc(c.key), plan: c.plan })),
        (a: { readonly key: string }, b: { readonly key: string }) => a.key === b.key,
      );
      return `$sw(${variable(scope, node.selector)}, [${Arr.join(
        Arr.map(cases, (c) => quote(c.key)),
        ", ",
      )}], [${Arr.join(
        Arr.map(cases, (c) => thunk(planCode(scope, c.plan, inlined))),
        ", ",
      )}]${node.otherwise === undefined ? "" : `, ${thunk(planCode(scope, node.otherwise, inlined))}`})`;
    },
  });

interface Bound {
  readonly scope: Scope;
  readonly lines: ReadonlyArray<string>;
}

/** Binds each declaration to a constant, in order. */
const empty: Bound = { scope: {}, lines: [] };

const declare = (lowered: Lowering.Lowered): Bound =>
  Arr.reduce(lowered.declarations, empty, (bound, declaration, i) => {
    const { name, value } = declaration;
    // An `.input`'s own operand reads the parameter.
    const scope = declaration.type === "input" ? R.remove(bound.scope, nfc(name)) : bound.scope;
    const constant = `v${i}`;
    return {
      scope: R.set(bound.scope, nfc(name), constant),
      lines: [
        ...bound.lines,
        `  const ${constant} = $bind(${expressionCode(scope, value)}, ${quote(`$${nfc(name)}`)});`,
      ],
    };
  });

/** One locale's implementation, as an arrow function. */
export const implementation = (lowered: Lowering.Lowered): string => {
  const { scope, lines } = declare(lowered);
  const inlined = R.fromEntries(Arr.map(lowered.preformat, (p) => [p.name, p.expression] as const));
  const code = planCode(scope, lowered.plan, inlined);
  const body = lowered.plan instanceof Plan.Leaf ? code : `${code} || []`;
  return Arr.isReadonlyArrayEmpty(lines)
    ? `(c, p) => ${body}`
    : `(c, p) => {\n${Arr.join(lines, "\n")}\n  return ${body};\n}`;
};

/** The helpers a module's code calls: every `$name` outside its string literals. */
export const helpersUsed = (code: string): ReadonlyArray<string> =>
  Arr.sort(
    Arr.dedupe(code.replaceAll(/"(?:[^"\\]|\\.)*"/g, '""').match(/\$[A-Za-z]+/g) ?? []),
    Str.Order,
  );
