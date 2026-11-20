/**
 * The MessageFormat 2 parser: source text to the {@link DataModel}. A
 * hand-written recursive-descent parser over the spec's ABNF that records a
 * span on every node.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as DataModel from "./DataModel";
import { isBidi, isNameChar, isNameStart, isWhitespace } from "./internal/characters";
import { DuplicateOptionName, InvalidSyntax, MessageFormatError } from "./MessageFormatError";

type Parsed<A> = Result.Result<A, MessageFormatError>;

/** Passes a failure up to a parser of another node. */
const propagate = (failure: Result.Failure<unknown, MessageFormatError>): Parsed<never> =>
  Result.fail(failure.failure);

type Placeholder = DataModel.Expression | DataModel.Markup;

const BACKSLASH = 0x5c;
const OPEN = 0x7b;
const CLOSE = 0x7d;
const PIPE = 0x7c;
const DOLLAR = 0x24;
const COLON = 0x3a;
const AT = 0x40;
const EQUALS = 0x3d;
const HASH = 0x23;
const SLASH = 0x2f;
const DOT = 0x2e;
const STAR = 0x2a;

const isEscapable = (c: number): boolean =>
  c === BACKSLASH || c === OPEN || c === PIPE || c === CLOSE;

// The parser's position in the source. Plain mutable state: this is the hot
// path, and nothing outside one `parse` call sees it.
class Cursor {
  pos = 0;
  constructor(readonly source: string) {}

  get done(): boolean {
    return this.pos >= this.source.length;
  }

  /** The code point at the cursor, or -1 at the end. */
  peek(offset = 0): number {
    return this.source.codePointAt(this.pos + offset) ?? -1;
  }

  /** The code unit at the cursor, or -1 at the end. */
  peekUnit(offset = 0): number {
    const unit = this.source.charCodeAt(this.pos + offset);
    return Number.isNaN(unit) ? -1 : unit;
  }

  advance(): void {
    this.pos += this.peek() > 0xffff ? 2 : 1;
  }

  span(start: number): DataModel.Span {
    return new DataModel.Span({ start, end: this.pos });
  }

  fail(expected: string, start = this.pos): Result.Result<never, MessageFormatError> {
    const end = Math.min(this.source.length, Math.max(start, this.pos) + 1);
    return Result.fail(
      new MessageFormatError({
        reason: new InvalidSyntax({ span: new DataModel.Span({ start, end }), expected }),
      }),
    );
  }

  /** Skips optional whitespace (`o`); says whether it held any `ws`. */
  skipOptional(): boolean {
    let sawWhitespace = false;
    for (;;) {
      const c = this.peekUnit();
      if (isWhitespace(c)) sawWhitespace = true;
      else if (!isBidi(c)) return sawWhitespace;
      this.pos++;
    }
  }

  startsWith(text: string): boolean {
    return this.source.startsWith(text, this.pos);
  }
}

/** `name`, without its optional bidi marks. */
const parseName = (cursor: Cursor): Parsed<string> => {
  if (isBidi(cursor.peekUnit())) cursor.pos++;
  if (!isNameStart(cursor.peek())) return cursor.fail("a name");
  const start = cursor.pos;
  while (isNameChar(cursor.peek())) cursor.advance();
  const name = cursor.source.slice(start, cursor.pos);
  if (isBidi(cursor.peekUnit())) cursor.pos++;
  return Result.succeed(name);
};

/** `identifier`: a name with an optional `namespace:`. */
const parseIdentifier = (cursor: Cursor): Parsed<string> => {
  const first = parseName(cursor);
  if (Result.isFailure(first)) return propagate(first);
  if (cursor.peekUnit() !== COLON) return first;
  cursor.pos++;
  const second = parseName(cursor);
  return Result.isFailure(second) ? second : Result.succeed(`${first.success}:${second.success}`);
};

const parseVariable = (cursor: Cursor): Parsed<DataModel.VariableRef> => {
  const start = cursor.pos;
  if (cursor.peekUnit() !== DOLLAR) return cursor.fail("a variable");
  cursor.pos++;
  const name = parseName(cursor);
  return Result.isFailure(name)
    ? propagate(name)
    : Result.succeed(new DataModel.VariableRef({ name: name.success, span: cursor.span(start) }));
};

/**
 * Text or quoted-literal content up to an unescaped `stop` code unit or the
 * end of input, with escapes processed. Leaves the cursor on the stop.
 */
const scanText = (cursor: Cursor, stop: (c: number) => boolean): Parsed<string> => {
  let value = "";
  let chunk = cursor.pos;
  for (let c = cursor.peekUnit(); c !== -1 && !stop(c); c = cursor.peekUnit()) {
    if (c === 0) return cursor.fail("a character other than U+0000");
    if (c === BACKSLASH) {
      if (!isEscapable(cursor.peekUnit(1))) return cursor.fail("an escape: \\\\, \\{, \\| or \\}");
      value += `${cursor.source.slice(chunk, cursor.pos)}${cursor.source[cursor.pos + 1]}`;
      cursor.pos += 2;
      chunk = cursor.pos;
    } else {
      cursor.pos++;
    }
  }
  return Result.succeed(value + cursor.source.slice(chunk, cursor.pos));
};

const isPipe = (c: number): boolean => c === PIPE;

const parseQuotedLiteral = (cursor: Cursor): Parsed<DataModel.Literal> => {
  const start = cursor.pos;
  cursor.pos++;
  const value = scanText(cursor, isPipe);
  if (Result.isFailure(value)) return propagate(value);
  if (cursor.peekUnit() !== PIPE) return cursor.fail("`|` to end the literal", start);
  cursor.pos++;
  return Result.succeed(new DataModel.Literal({ value: value.success, span: cursor.span(start) }));
};

const parseLiteral = (cursor: Cursor): Parsed<DataModel.Literal> => {
  if (cursor.peekUnit() === PIPE) return parseQuotedLiteral(cursor);
  const start = cursor.pos;
  while (isNameChar(cursor.peek())) cursor.advance();
  if (cursor.pos === start) return cursor.fail("a literal");
  return Result.succeed(
    new DataModel.Literal({
      value: cursor.source.slice(start, cursor.pos),
      span: cursor.span(start),
    }),
  );
};

const isLiteralStart = (c: number): boolean => c === PIPE || isNameChar(c);

const parseOperand = (cursor: Cursor): Parsed<DataModel.Operand> =>
  cursor.peekUnit() === DOLLAR ? parseVariable(cursor) : parseLiteral(cursor);

const isIdentifierStart = (cursor: Cursor): boolean =>
  isNameStart(cursor.peek()) || (isBidi(cursor.peekUnit()) && isNameStart(cursor.peek(1)));

/** `*(s option)`, after a function or markup identifier. */
const parseOptions = (cursor: Cursor): Parsed<DataModel.Options> => {
  const options: Record<string, DataModel.Operand> = {};
  for (;;) {
    const before = cursor.pos;
    if (!cursor.skipOptional() || !isIdentifierStart(cursor)) {
      cursor.pos = before;
      return Result.succeed(options);
    }
    const start = cursor.pos;
    const name = parseIdentifier(cursor);
    if (Result.isFailure(name)) return propagate(name);
    cursor.skipOptional();
    if (cursor.peekUnit() !== EQUALS) return cursor.fail("`=` after the option name");
    cursor.pos++;
    cursor.skipOptional();
    const value = parseOperand(cursor);
    if (Result.isFailure(value)) return propagate(value);
    if (Object.hasOwn(options, name.success)) {
      return Result.fail(
        new MessageFormatError({
          reason: new DuplicateOptionName({ span: cursor.span(start), option: name.success }),
        }),
      );
    }
    options[name.success] = value.success;
  }
};

/** `*(s attribute)`; a repeated attribute keeps its last value. */
const parseAttributes = (cursor: Cursor): Parsed<DataModel.Attributes> => {
  const attributes: Record<string, DataModel.Literal | true> = {};
  for (;;) {
    const before = cursor.pos;
    if (!cursor.skipOptional() || cursor.peekUnit() !== AT) {
      cursor.pos = before;
      return Result.succeed(attributes);
    }
    cursor.pos++;
    const name = parseIdentifier(cursor);
    if (Result.isFailure(name)) return propagate(name);
    const afterName = cursor.pos;
    cursor.skipOptional();
    if (cursor.peekUnit() === EQUALS) {
      cursor.pos++;
      cursor.skipOptional();
      const value = parseLiteral(cursor);
      if (Result.isFailure(value)) return propagate(value);
      attributes[name.success] = value.success;
    } else {
      cursor.pos = afterName;
      attributes[name.success] = true;
    }
  }
};

/** `identifier *(s option)`, after a function's or markup's sigil. */
const parseNameAndOptions = (
  cursor: Cursor,
): Parsed<{ readonly name: string; readonly options: DataModel.Options }> => {
  cursor.pos++;
  const name = parseIdentifier(cursor);
  if (Result.isFailure(name)) return propagate(name);
  const options = parseOptions(cursor);
  if (Result.isFailure(options)) return propagate(options);
  return Result.succeed({ name: name.success, options: options.success });
};

/** `":" identifier *(s option)`. */
const parseFunction = (cursor: Cursor): Parsed<DataModel.FunctionRef> => {
  const start = cursor.pos;
  const named = parseNameAndOptions(cursor);
  if (Result.isFailure(named)) return propagate(named);
  return Result.succeed(new DataModel.FunctionRef({ ...named.success, span: cursor.span(start) }));
};

/** The `o "}"` that ends every placeholder. */
const closePlaceholder = (cursor: Cursor, what: string): Parsed<void> => {
  cursor.skipOptional();
  if (cursor.peekUnit() !== CLOSE) return cursor.fail(`\`}\` to end the ${what}`);
  cursor.pos++;
  return Result.succeed(undefined);
};

const parseMarkup = (cursor: Cursor, start: number): Parsed<DataModel.Markup> => {
  const close = cursor.peekUnit() === SLASH;
  const named = parseNameAndOptions(cursor);
  if (Result.isFailure(named)) return propagate(named);
  const attributes = parseAttributes(cursor);
  if (Result.isFailure(attributes)) return propagate(attributes);
  cursor.skipOptional();
  let kind: DataModel.Markup["kind"] = close ? "close" : "open";
  if (!close && cursor.peekUnit() === SLASH) {
    kind = "standalone";
    cursor.pos++;
  }
  const closed = closePlaceholder(cursor, "markup");
  if (Result.isFailure(closed)) return propagate(closed);
  return Result.succeed(
    new DataModel.Markup({
      ...named.success,
      kind,
      attributes: attributes.success,
      span: cursor.span(start),
    }),
  );
};

/** `":" identifier *(s option) *(s attribute) o "}"`, after `{ o`. */
const parseFunctionExpression = (
  cursor: Cursor,
  start: number,
): Parsed<DataModel.FunctionExpression> => {
  const fn = parseFunction(cursor);
  if (Result.isFailure(fn)) return propagate(fn);
  const attributes = parseAttributes(cursor);
  if (Result.isFailure(attributes)) return propagate(attributes);
  const closed = closePlaceholder(cursor, "expression");
  if (Result.isFailure(closed)) return propagate(closed);
  return Result.succeed(
    new DataModel.FunctionExpression({
      function: fn.success,
      attributes: attributes.success,
      span: cursor.span(start),
    }),
  );
};

/** `operand [s function] *(s attribute) o "}"`, after `{ o`. */
const parseOperandExpression = (
  cursor: Cursor,
  start: number,
): Parsed<DataModel.LiteralExpression | DataModel.VariableExpression> => {
  const operand = parseOperand(cursor);
  if (Result.isFailure(operand)) return propagate(operand);
  let fn: Partial<Pick<DataModel.VariableExpression, "function">> = {};
  const beforeFunction = cursor.pos;
  if (cursor.skipOptional() && cursor.peekUnit() === COLON) {
    const parsed = parseFunction(cursor);
    if (Result.isFailure(parsed)) return propagate(parsed);
    fn = { function: parsed.success };
  } else {
    cursor.pos = beforeFunction;
  }
  const attributes = parseAttributes(cursor);
  if (Result.isFailure(attributes)) return propagate(attributes);
  const closed = closePlaceholder(cursor, "expression");
  if (Result.isFailure(closed)) return propagate(closed);
  const fields = { ...fn, attributes: attributes.success, span: cursor.span(start) };
  return Result.succeed(
    operand.success.type === "literal"
      ? new DataModel.LiteralExpression({ ...fields, arg: operand.success })
      : new DataModel.VariableExpression({ ...fields, arg: operand.success }),
  );
};

/** `"{" o … "}"`: an expression or markup. */
const parsePlaceholder = (cursor: Cursor): Parsed<Placeholder> => {
  const start = cursor.pos;
  cursor.pos++;
  cursor.skipOptional();
  const c = cursor.peekUnit();
  if (c === HASH || c === SLASH) return parseMarkup(cursor, start);
  if (c === COLON) return parseFunctionExpression(cursor, start);
  if (c === DOLLAR || isLiteralStart(cursor.peek())) return parseOperandExpression(cursor, start);
  return cursor.fail("an operand, a function or markup");
};

const isBrace = (c: number): boolean => c === OPEN || c === CLOSE;

/**
 * `*(text-char / escaped-char / placeholder)` up to the end of input for a
 * simple message, or up to `}}` for a quoted one.
 */
const parsePattern = (cursor: Cursor, quoted: boolean): Parsed<DataModel.Pattern> => {
  const pattern: Array<string | Placeholder> = [];
  for (;;) {
    const text = scanText(cursor, isBrace);
    if (Result.isFailure(text)) return propagate(text);
    if (text.success !== "") pattern.push(text.success);
    if (cursor.peekUnit() !== OPEN) break;
    const placeholder = parsePlaceholder(cursor);
    if (Result.isFailure(placeholder)) return propagate(placeholder);
    pattern.push(placeholder.success);
  }
  if (quoted ? !cursor.startsWith("}}") : !cursor.done) {
    return cursor.fail(quoted ? "`}}` to end the pattern" : "`\\}` instead of `}` in text");
  }
  return Result.succeed(pattern);
};

/** `"{{" pattern "}}"`. */
const parseQuotedPattern = (cursor: Cursor): Parsed<DataModel.Pattern> => {
  if (!cursor.startsWith("{{")) return cursor.fail("`{{` to start a pattern");
  cursor.pos += 2;
  const pattern = parsePattern(cursor, true);
  if (Result.isFailure(pattern)) return propagate(pattern);
  cursor.pos += 2;
  return pattern;
};

/** A placeholder that must be an expression, as in a declaration. */
const parseDeclaredExpression = (cursor: Cursor): Parsed<DataModel.Expression> => {
  if (cursor.peekUnit() !== OPEN) return cursor.fail("`{` to start an expression");
  const start = cursor.pos;
  const placeholder = parsePlaceholder(cursor);
  if (Result.isFailure(placeholder)) return propagate(placeholder);
  return placeholder.success.type === "markup"
    ? cursor.fail("an expression, not markup", start)
    : Result.succeed(placeholder.success);
};

/** `input o variable-expression`, after `.input`. */
const parseInput = (cursor: Cursor, start: number): Parsed<DataModel.InputDeclaration> => {
  cursor.skipOptional();
  const valueStart = cursor.pos;
  const value = parseDeclaredExpression(cursor);
  if (Result.isFailure(value)) return propagate(value);
  if (!(value.success instanceof DataModel.VariableExpression)) {
    return cursor.fail("a variable expression, as in `{$name}`", valueStart);
  }
  return Result.succeed(
    new DataModel.InputDeclaration({ value: value.success, span: cursor.span(start) }),
  );
};

/** `local s variable o "=" o expression`, after `.local`. */
const parseLocal = (cursor: Cursor, start: number): Parsed<DataModel.LocalDeclaration> => {
  if (!cursor.skipOptional()) return cursor.fail("whitespace after `.local`");
  const variable = parseVariable(cursor);
  if (Result.isFailure(variable)) return propagate(variable);
  cursor.skipOptional();
  if (cursor.peekUnit() !== EQUALS) return cursor.fail("`=` after the variable");
  cursor.pos++;
  cursor.skipOptional();
  const value = parseDeclaredExpression(cursor);
  if (Result.isFailure(value)) return propagate(value);
  return Result.succeed(
    new DataModel.LocalDeclaration({
      name: variable.success.name,
      value: value.success,
      span: cursor.span(start),
    }),
  );
};

const parseKey = (cursor: Cursor): Parsed<DataModel.Key> => {
  if (cursor.peekUnit() !== STAR) return parseLiteral(cursor);
  const start = cursor.pos;
  cursor.pos++;
  return Result.succeed(new DataModel.CatchallKey({ span: cursor.span(start) }));
};

/** `key *(s key) o quoted-pattern`. */
const parseVariant = (cursor: Cursor): Parsed<DataModel.Variant> => {
  const start = cursor.pos;
  const keys: Array<DataModel.Key> = [];
  for (;;) {
    const key = parseKey(cursor);
    if (Result.isFailure(key)) return propagate(key);
    keys.push(key.success);
    const spaced = cursor.skipOptional();
    if (cursor.peekUnit() === OPEN) break;
    if (!spaced) return cursor.fail("whitespace between keys");
  }
  const value = parseQuotedPattern(cursor);
  if (Result.isFailure(value)) return propagate(value);
  return Result.succeed(
    new DataModel.Variant({ keys, value: value.success, span: cursor.span(start) }),
  );
};

/** `match-statement s variant *(o variant)`, after `.match`. */
const parseMatcher = (
  cursor: Cursor,
  declarations: ReadonlyArray<DataModel.Declaration>,
  start: number,
): Parsed<DataModel.SelectMessage> => {
  const selectors: Array<DataModel.VariableRef> = [];
  let spaced = cursor.skipOptional();
  while (cursor.peekUnit() === DOLLAR) {
    if (!spaced) return cursor.fail("whitespace before the selector");
    const selector = parseVariable(cursor);
    if (Result.isFailure(selector)) return propagate(selector);
    selectors.push(selector.success);
    spaced = cursor.skipOptional();
  }
  if (Arr.isReadonlyArrayEmpty(selectors)) return cursor.fail("a selector, as in `$count`");
  if (!spaced) return cursor.fail("whitespace before the first variant");
  const variants: Array<DataModel.Variant> = [];
  while (!cursor.done) {
    const variant = parseVariant(cursor);
    if (Result.isFailure(variant)) return propagate(variant);
    variants.push(variant.success);
    cursor.skipOptional();
  }
  if (Arr.isReadonlyArrayEmpty(variants)) return cursor.fail("a variant");
  return Result.succeed(
    new DataModel.SelectMessage({ declarations, selectors, variants, span: cursor.span(start) }),
  );
};

/** Reads `.input`, `.local` or `.match` at the cursor. */
const parseKeyword = (cursor: Cursor): Option.Option<"input" | "local" | "match"> => {
  const keyword = Arr.findFirst(["input", "local", "match"] as const, (candidate) =>
    cursor.startsWith(`.${candidate}`),
  );
  if (Option.isSome(keyword)) cursor.pos += keyword.value.length + 1;
  return keyword;
};

const parseComplexMessage = (cursor: Cursor): Parsed<DataModel.Message> => {
  const start = cursor.pos;
  const declarations: Array<DataModel.Declaration> = [];
  while (cursor.peekUnit() === DOT) {
    const keywordStart = cursor.pos;
    const keyword = parseKeyword(cursor);
    if (Option.isNone(keyword)) return cursor.fail("`.input`, `.local` or `.match`");
    if (keyword.value === "match") return parseMatcher(cursor, declarations, start);
    const declaration: Parsed<DataModel.Declaration> =
      keyword.value === "input"
        ? parseInput(cursor, keywordStart)
        : parseLocal(cursor, keywordStart);
    if (Result.isFailure(declaration)) return propagate(declaration);
    declarations.push(declaration.success);
    cursor.skipOptional();
  }
  const pattern = parseQuotedPattern(cursor);
  if (Result.isFailure(pattern)) return propagate(pattern);
  const end = cursor.pos;
  cursor.skipOptional();
  if (!cursor.done) return cursor.fail("the end of the message after its pattern");
  return Result.succeed(
    new DataModel.PatternMessage({
      declarations,
      pattern: pattern.success,
      span: new DataModel.Span({ start, end }),
    }),
  );
};

/**
 * Parses a message, returning the first error if it isn't well-formed.
 * Synchronous, for callers outside Effect.
 *
 * @category parsing
 * @since 0.1.0
 */
export const parseResult = (
  source: string,
): Result.Result<DataModel.Message, MessageFormatError> => {
  const cursor = new Cursor(source);
  cursor.skipOptional();
  if (cursor.peekUnit() === DOT || cursor.startsWith("{{")) return parseComplexMessage(cursor);
  // A simple message's leading whitespace is text.
  cursor.pos = 0;
  const pattern = parsePattern(cursor, false);
  return Result.isFailure(pattern)
    ? propagate(pattern)
    : Result.succeed(
        new DataModel.PatternMessage({ pattern: pattern.success, span: cursor.span(0) }),
      );
};

/**
 * Parses a message, failing with a `MessageFormatError` if it isn't
 * well-formed.
 *
 * @category parsing
 * @since 0.1.0
 */
export const parse = (source: string): Effect.Effect<DataModel.Message, MessageFormatError> =>
  Effect.fromResult(parseResult(source));
