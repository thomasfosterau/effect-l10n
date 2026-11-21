/**
 * The Unicode MessageFormat 2 data model as Effect `Schema` classes. Every
 * node keeps the spec's `type` discriminant, so a node's JSON form is exactly
 * the spec's interchange data model.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect";
import * as Eq from "effect/Equal";
import * as Hash from "effect/Hash";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as Struct from "effect/Struct";

// The `name` production without its optional bidi marks, which are not part
// of the value.
const nameStart =
  "A-Za-z+_\\u00A1-\\u061B\\u061D-\\u167F\\u1681-\\u1FFF\\u200B-\\u200D\\u2010-\\u2027\\u2030-\\u205E\\u2060-\\u2065\\u206A-\\u2FFF\\u3001-\\uD7FF\\uE000-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{1FFFD}\\u{20000}-\\u{2FFFD}\\u{30000}-\\u{3FFFD}\\u{40000}-\\u{4FFFD}\\u{50000}-\\u{5FFFD}\\u{60000}-\\u{6FFFD}\\u{70000}-\\u{7FFFD}\\u{80000}-\\u{8FFFD}\\u{90000}-\\u{9FFFD}\\u{A0000}-\\u{AFFFD}\\u{B0000}-\\u{BFFFD}\\u{C0000}-\\u{CFFFD}\\u{D0000}-\\u{DFFFD}\\u{E0000}-\\u{EFFFD}\\u{F0000}-\\u{FFFFD}\\u{100000}-\\u{10FFFD}";
const name = `[${nameStart}][${nameStart}0-9\\-.]*`;

/**
 * A `name`: a variable, option, attribute or namespace name, without bidi
 * marks or sigils.
 *
 * @category names
 * @since 0.1.0
 */
export const Name = Schema.String.check(Schema.isPattern(new RegExp(`^${name}$`, "u")));

/**
 * @category names
 * @since 0.1.0
 */
export type Name = typeof Name.Type;

/**
 * An `identifier`: a {@link Name} with an optional namespace, as in `u:dir`.
 *
 * @category names
 * @since 0.1.0
 */
export const Identifier = Schema.String.check(
  Schema.isPattern(new RegExp(`^(?:${name}:)?${name}$`, "u")),
);

/**
 * @category names
 * @since 0.1.0
 */
export type Identifier = typeof Identifier.Type;

// Text and literals may hold any code unit but U+0000, which MF2 syntax
// cannot represent; unpaired surrogates are allowed, as in the spec.
const Characters = Schema.String.check(Schema.isPattern(/^[^\0]*$/));

/**
 * Where a node came from in the source: UTF-16 code unit offsets, `start`
 * inclusive and `end` exclusive.
 *
 * @category spans
 * @since 0.1.0
 */
export class Span extends Schema.Class<Span, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/messageformat/Span",
)({
  start: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  end: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}) {}

const span = Schema.optionalKey(Span);

interface Spanned {
  readonly span?: Span;
}

// Spans say where a node was parsed from, not what it means, so equality and
// hashing skip them: the same message parsed from two places compares equal.
const withoutSpan = <A extends Spanned>(node: A): Omit<A, "span"> => Struct.omit(node, ["span"]);

/**
 * A literal value, quoted or not; `value` has escapes already processed.
 *
 * @category expressions
 * @since 0.1.0
 */
export class Literal extends Schema.Class<Literal, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/messageformat/Literal",
)({ type: Schema.tag("literal"), value: Characters, span }) {
  [Eq.symbol](that: Eq.Equal): boolean {
    return that instanceof Literal && Eq.equals(withoutSpan(this), withoutSpan(that));
  }
  [Hash.symbol](): number {
    return Hash.structure(withoutSpan(this));
  }
}

/**
 * A reference to a variable; `name` has no `$`.
 *
 * @category expressions
 * @since 0.1.0
 */
export class VariableRef extends Schema.Class<VariableRef, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/messageformat/VariableRef",
)({ type: Schema.tag("variable"), name: Name, span }) {
  [Eq.symbol](that: Eq.Equal): boolean {
    return that instanceof VariableRef && Eq.equals(withoutSpan(this), withoutSpan(that));
  }
  [Hash.symbol](): number {
    return Hash.structure(withoutSpan(this));
  }
}

/**
 * An option value or an expression's operand.
 *
 * @category expressions
 * @since 0.1.0
 */
export const Operand = Schema.Union([Literal, VariableRef]).pipe(Schema.toTaggedUnion("type"));

/**
 * @category expressions
 * @since 0.1.0
 */
export type Operand = typeof Operand.Type;

/**
 * Function and markup options, by identifier, in source order.
 *
 * @category expressions
 * @since 0.1.0
 */
export const Options = Schema.Record(Identifier, Operand);

/**
 * @category expressions
 * @since 0.1.0
 */
export type Options = typeof Options.Type;

/**
 * Expression and markup attributes, by identifier; an attribute without a
 * value is `true`.
 *
 * @category expressions
 * @since 0.1.0
 */
export const Attributes = Schema.Record(Identifier, Schema.Union([Literal, Schema.Literal(true)]));

/**
 * @category expressions
 * @since 0.1.0
 */
export type Attributes = typeof Attributes.Type;

// The spec's JSON may leave `options`, `attributes` and `declarations` out
// when they are empty; the decoded model and the constructors fill them in.
const optionsField = Options.pipe(
  Schema.withDecodingDefaultKey(Effect.succeed({})),
  Schema.withConstructorDefault(Effect.succeed({})),
);
const attributesField = Attributes.pipe(
  Schema.withDecodingDefaultKey(Effect.succeed({})),
  Schema.withConstructorDefault(Effect.succeed({})),
);

/**
 * A function annotation, as in `:number minimumFractionDigits=2`; `name` has
 * no `:`.
 *
 * @category expressions
 * @since 0.1.0
 */
export class FunctionRef extends Schema.Class<FunctionRef, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/messageformat/FunctionRef",
)({ type: Schema.tag("function"), name: Identifier, options: optionsField, span }) {
  [Eq.symbol](that: Eq.Equal): boolean {
    return that instanceof FunctionRef && Eq.equals(withoutSpan(this), withoutSpan(that));
  }
  [Hash.symbol](): number {
    return Hash.structure(withoutSpan(this));
  }
}

/**
 * An expression whose operand is a literal, as in `{|1.5| :number}`.
 *
 * @category expressions
 * @since 0.1.0
 */
export class LiteralExpression extends Schema.Class<
  LiteralExpression,
  { readonly brand: unique symbol }
>("@thomasfosterau/effect-l10n/messageformat/LiteralExpression")({
  type: Schema.tag("expression"),
  arg: Literal,
  function: Schema.optionalKey(FunctionRef),
  attributes: attributesField,
  span,
}) {
  [Eq.symbol](that: Eq.Equal): boolean {
    return that instanceof LiteralExpression && Eq.equals(withoutSpan(this), withoutSpan(that));
  }
  [Hash.symbol](): number {
    return Hash.structure(withoutSpan(this));
  }
}

/**
 * An expression whose operand is a variable, as in `{$count :integer}`.
 *
 * @category expressions
 * @since 0.1.0
 */
export class VariableExpression extends Schema.Class<
  VariableExpression,
  { readonly brand: unique symbol }
>("@thomasfosterau/effect-l10n/messageformat/VariableExpression")({
  type: Schema.tag("expression"),
  arg: VariableRef,
  function: Schema.optionalKey(FunctionRef),
  attributes: attributesField,
  span,
}) {
  [Eq.symbol](that: Eq.Equal): boolean {
    return that instanceof VariableExpression && Eq.equals(withoutSpan(this), withoutSpan(that));
  }
  [Hash.symbol](): number {
    return Hash.structure(withoutSpan(this));
  }
}

/**
 * An expression with a function and no operand, as in `{:datetime}`.
 *
 * @category expressions
 * @since 0.1.0
 */
export class FunctionExpression extends Schema.Class<
  FunctionExpression,
  { readonly brand: unique symbol }
>("@thomasfosterau/effect-l10n/messageformat/FunctionExpression")({
  type: Schema.tag("expression"),
  function: FunctionRef,
  attributes: attributesField,
  span,
}) {
  [Eq.symbol](that: Eq.Equal): boolean {
    return that instanceof FunctionExpression && Eq.equals(withoutSpan(this), withoutSpan(that));
  }
  [Hash.symbol](): number {
    return Hash.structure(withoutSpan(this));
  }
}

/**
 * A placeholder or declared value. As in the spec, all three shapes have the
 * `expression` type; they differ in their operand.
 *
 * @category expressions
 * @since 0.1.0
 */
export const Expression = Schema.Union([LiteralExpression, VariableExpression, FunctionExpression]);

/**
 * @category expressions
 * @since 0.1.0
 */
export type Expression = typeof Expression.Type;

/**
 * Markup, as in `{#b}`, `{#img/}` or `{/b}`; `name` has no sigils.
 *
 * @category patterns
 * @since 0.1.0
 */
export class Markup extends Schema.Class<Markup, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/messageformat/Markup",
)({
  type: Schema.tag("markup"),
  kind: Schema.Literals(["open", "standalone", "close"]),
  name: Identifier,
  options: optionsField,
  attributes: attributesField,
  span,
}) {
  [Eq.symbol](that: Eq.Equal): boolean {
    return that instanceof Markup && Eq.equals(withoutSpan(this), withoutSpan(that));
  }
  [Hash.symbol](): number {
    return Hash.structure(withoutSpan(this));
  }
}

/**
 * Text, with escapes already processed. Never empty.
 *
 * @category patterns
 * @since 0.1.0
 */
export const Text = Characters.check(Schema.isMinLength(1));

/**
 * @category patterns
 * @since 0.1.0
 */
export type Text = typeof Text.Type;

/**
 * A pattern: text and placeholders in order.
 *
 * @category patterns
 * @since 0.1.0
 */
export const Pattern = Schema.Array(Schema.Union([Text, Expression, Markup]));

/**
 * @category patterns
 * @since 0.1.0
 */
export type Pattern = typeof Pattern.Type;

/**
 * `.input {$name …}`: annotates an external variable. Its name is its
 * operand's, so the model stores it once; the JSON form carries both and
 * rejects a mismatch.
 *
 * @category declarations
 * @since 0.1.0
 */
export class InputDeclaration extends Schema.Class<
  InputDeclaration,
  { readonly brand: unique symbol }
>("@thomasfosterau/effect-l10n/messageformat/InputDeclaration")({
  type: Schema.tag("input"),
  value: VariableExpression,
  span,
}) {
  /** The declared variable's name, without `$`. */
  get name(): Name {
    return this.value.arg.name;
  }
  [Eq.symbol](that: Eq.Equal): boolean {
    return that instanceof InputDeclaration && Eq.equals(withoutSpan(this), withoutSpan(that));
  }
  [Hash.symbol](): number {
    return Hash.structure(withoutSpan(this));
  }
}

const InputDeclarationCodec = Schema.Struct({
  type: Schema.Literal("input"),
  name: Name,
  value: Schema.toEncoded(VariableExpression),
  span: Schema.optionalKey(Schema.toEncoded(Span)),
})
  .check(
    Schema.makeFilter((declaration) => declaration.value.arg.name === declaration.name, {
      identifier: "InputDeclarationName",
      title: "input declaration name",
      description: "an input declaration is named after its variable",
    }),
  )
  .pipe(
    Schema.decodeTo(
      InputDeclaration,
      SchemaTransformation.transform({
        decode: Struct.omit(["name"]),
        encode: (declaration) => ({ ...declaration, name: declaration.value.arg.name }),
      }),
    ),
  );

/**
 * `.local $name = {…}`: binds a new variable.
 *
 * @category declarations
 * @since 0.1.0
 */
export class LocalDeclaration extends Schema.Class<
  LocalDeclaration,
  { readonly brand: unique symbol }
>("@thomasfosterau/effect-l10n/messageformat/LocalDeclaration")({
  type: Schema.tag("local"),
  name: Name,
  value: Expression,
  span,
}) {
  [Eq.symbol](that: Eq.Equal): boolean {
    return that instanceof LocalDeclaration && Eq.equals(withoutSpan(this), withoutSpan(that));
  }
  [Hash.symbol](): number {
    return Hash.structure(withoutSpan(this));
  }
}

/**
 * @category declarations
 * @since 0.1.0
 */
export const Declaration = Schema.Union([InputDeclarationCodec, LocalDeclaration]).pipe(
  Schema.toTaggedUnion("type"),
);

/**
 * @category declarations
 * @since 0.1.0
 */
export type Declaration = typeof Declaration.Type;

const declarationsField = Schema.Array(Declaration).pipe(
  Schema.withDecodingDefaultKey(Effect.succeed([])),
  Schema.withConstructorDefault(Effect.succeed([])),
);

/**
 * The `*` key, which matches anything. `value` keeps another syntax's name for
 * it; MF2 always writes `*`.
 *
 * @category selection
 * @since 0.1.0
 */
export class CatchallKey extends Schema.Class<CatchallKey, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/messageformat/CatchallKey",
)({ type: Schema.tag("*"), value: Schema.optionalKey(Schema.String), span }) {
  [Eq.symbol](that: Eq.Equal): boolean {
    return that instanceof CatchallKey && Eq.equals(withoutSpan(this), withoutSpan(that));
  }
  [Hash.symbol](): number {
    return Hash.structure(withoutSpan(this));
  }
}

/**
 * A variant key.
 *
 * @category selection
 * @since 0.1.0
 */
export const Key = Schema.Union([Literal, CatchallKey]).pipe(Schema.toTaggedUnion("type"));

/**
 * @category selection
 * @since 0.1.0
 */
export type Key = typeof Key.Type;

/**
 * One variant of a `.match`: a key per selector, and the pattern it selects.
 *
 * @category selection
 * @since 0.1.0
 */
export class Variant extends Schema.Class<Variant, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/messageformat/Variant",
)({ keys: Schema.NonEmptyArray(Key), value: Pattern, span }) {
  [Eq.symbol](that: Eq.Equal): boolean {
    return that instanceof Variant && Eq.equals(withoutSpan(this), withoutSpan(that));
  }
  [Hash.symbol](): number {
    return Hash.structure(withoutSpan(this));
  }
}

/**
 * A message with one pattern.
 *
 * @category messages
 * @since 0.1.0
 */
export class PatternMessage extends Schema.Class<PatternMessage, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/messageformat/PatternMessage",
)({
  type: Schema.tag("message"),
  declarations: declarationsField,
  pattern: Pattern,
  span,
}) {
  [Eq.symbol](that: Eq.Equal): boolean {
    return that instanceof PatternMessage && Eq.equals(withoutSpan(this), withoutSpan(that));
  }
  [Hash.symbol](): number {
    return Hash.structure(withoutSpan(this));
  }
}

/**
 * A message that selects one of its variants by its selectors' values. As in
 * the syntax, it has at least one selector and one variant, and every variant
 * at least one key.
 *
 * @category messages
 * @since 0.1.0
 */
export class SelectMessage extends Schema.Class<SelectMessage, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-l10n/messageformat/SelectMessage",
)({
  type: Schema.tag("select"),
  declarations: declarationsField,
  selectors: Schema.NonEmptyArray(VariableRef),
  variants: Schema.NonEmptyArray(Variant),
  span,
}) {
  [Eq.symbol](that: Eq.Equal): boolean {
    return that instanceof SelectMessage && Eq.equals(withoutSpan(this), withoutSpan(that));
  }
  [Hash.symbol](): number {
    return Hash.structure(withoutSpan(this));
  }
}

/**
 * A message: the root of the data model.
 *
 * @category messages
 * @since 0.1.0
 */
export const Message = Schema.Union([PatternMessage, SelectMessage]).pipe(
  Schema.toTaggedUnion("type"),
);

/**
 * @category messages
 * @since 0.1.0
 */
export type Message = typeof Message.Type;

/**
 * A {@link Message} as the spec's JSON data model.
 *
 * @category codecs
 * @since 0.1.0
 */
export const MessageJson = Schema.toCodecJson(Message);

/**
 * @category codecs
 * @since 0.1.0
 */
export type MessageJson = typeof MessageJson.Encoded;
