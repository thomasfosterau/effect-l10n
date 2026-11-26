// The emitted `internal.js`: the MessageFormat 2 default functions and the
// helpers each message module calls, in plain JavaScript (ADR 0003). It
// mirrors the reference formatter's semantics; the equivalence tests hold
// the two together.

/** Plain-JavaScript source with no backticks or interpolation, emitted verbatim. */
const helpers = String.raw`const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const NO = {};
const POP = { type: "bidiIsolation", value: "⁩" };
const isolates = { ltr: "⁦", rtl: "⁧", auto: "⁨" };

const cached = (build) => {
  const store = new Map();
  return (locale, options) => {
    const key = locale + "\u0000" + JSON.stringify(options);
    let found = store.get(key);
    if (found === undefined) {
      try {
        found = build(locale, options);
      } catch {
        return undefined;
      }
      store.set(key, found);
    }
    return found;
  };
};
const numberFormat = /* @__PURE__ */ cached((l, o) => new Intl.NumberFormat(l, o));
const pluralRules = /* @__PURE__ */ cached((l, o) => new Intl.PluralRules(l, o));
const dateTimeFormat = /* @__PURE__ */ cached((l, o) => new Intl.DateTimeFormat(l, o));

const merge = (a, b) => Object.assign({}, a, b);
const pick = (o, keys) => {
  const r = {};
  for (const k of keys) if (own(o, k)) r[k] = o[k];
  return r;
};
const omit = (o, keys) => {
  const r = {};
  for (const k of Object.keys(o)) if (!keys.includes(k)) r[k] = o[k];
  return r;
};

const text = (value, raw) => ({
  t: "string",
  v: raw,
  o: {},
  d: "auto",
  f: () => ({ type: "string", value }),
});

/** A literal operand. */
export const $lit = (value) => text(value, value);

/** A parameter: numbers read as ':number', other primitives as strings. */
export const $param = (c, p, name) => {
  // Names compare after NFC, as the reference's do.
  const key = own(p, name) ? name : Object.keys(p).find((k) => k.normalize("NFC") === name);
  if (key === undefined) return { fb: "$" + name };
  const raw = p[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return nv(c, "number", raw, {}, {}, "plural");
  return typeof raw === "string" ||
    typeof raw === "number" ||
    typeof raw === "boolean" ||
    typeof raw === "bigint"
    ? text(String(raw), raw)
    : { t: "string", v: raw, o: {}, d: "auto" };
};

/** A declared variable's value: one that fell back falls back to its own name. */
export const $bind = (v, source) => (v.fb === undefined ? v : { fb: source });

const optionValue = (option) =>
  option[0] ? option[1] : option[1].fb === undefined ? option[1].v : undefined;

/** Calls a function: decodes its operand and options as the reference does, then annotates. */
export const $call = (c, def, operand, options, source, dir, id) => {
  if (def === undefined) return { fb: source };
  const arg =
    operand === undefined
      ? undefined
      : operand.fb === undefined
        ? operand
        : { t: "string", v: undefined, o: {}, d: "auto" };
  const x = def.a(arg === undefined ? undefined : arg.v);
  if (x === NO) return { fb: source };
  const given = {};
  for (const k of Object.keys(options)) {
    const option = options[k];
    if (option[0] || option[1].fb === undefined) given[k] = [option[0], optionValue(option)];
  }
  const explicit = Object.keys(given).filter((k) => own(def.o, k));
  const candidates = [];
  if (arg !== undefined)
    for (const k of def.i || Object.keys(def.o))
      if (own(arg.o, k) && !explicit.includes(k)) candidates.push([k, false, arg.o[k]]);
  for (const k of explicit) candidates.push([k, given[k][0], given[k][1]]);
  const o = {};
  const rejected = [];
  for (const [k, literal, value] of candidates) {
    const decoded = def.l !== undefined && def.l.includes(k) && !literal ? NO : def.o[k](value);
    if (decoded === NO) rejected.push(k);
    else o[k] = decoded;
  }
  const value = def.r(c, x, o, rejected, arg);
  if (value === undefined) return { fb: source };
  const d = dir === undefined ? undefined : optionValue(dir);
  const set = d === "ltr" || d === "rtl" || d === "auto";
  const i = id === undefined ? undefined : optionValue(id);
  const annotated = { ...value, d: set ? d : value.d, i: set };
  if (typeof i === "string") annotated.id = i;
  return annotated;
};

/** A placeholder's parts, isolated by the default bidi strategy. */
export const $ph = (c, v, source) => {
  let part;
  let d = "auto";
  let i = false;
  const formatted = v.fb !== undefined || v.f === undefined ? undefined : v.f();
  if (v.fb !== undefined) part = { type: "fallback", source: v.fb };
  else if (formatted === undefined) part = { type: "fallback", source };
  else {
    part = { type: formatted.type, value: formatted.value, parts: formatted.parts || [], locale: c.l };
    if (v.i && v.d !== "auto") part.dir = v.d;
    if (v.id !== undefined) part.id = v.id;
    d = v.d;
    i = v.i;
  }
  if (!c.b || (d === "ltr" && c.d === "ltr" && !i)) return [part];
  return [{ type: "bidiIsolation", value: isolates[d] }, part, POP];
};

/** A markup placeholder. */
export const $mk = (kind, name, options, id) => {
  const resolved = {};
  for (const k of Object.keys(options)) {
    const option = options[k];
    if (option[0] || option[1].fb === undefined) resolved[k] = optionValue(option);
  }
  const part = { type: "markup", kind, name, options: resolved };
  const i = id === undefined ? undefined : optionValue(id);
  if (typeof i === "string") part.id = i;
  return [part];
};

/** A pattern's parts: strings are text, the rest already parts. */
export const $out = (items) => {
  const parts = [];
  for (const item of items) {
    if (typeof item === "string") parts.push({ type: "text", value: item });
    else for (const part of item) parts.push(part);
  }
  return parts;
};

/** Selects on a value: the first matching case whose plan matches, then the '*' case. */
export const $sw = (v, keys, cases, otherwise) => {
  const matched = v.fb === undefined && v.s !== undefined ? v.s(keys) : undefined;
  if (matched !== undefined)
    for (const key of matched) {
      const found = cases[keys.indexOf(key)]();
      if (found !== undefined) return found;
    }
  return otherwise === undefined ? undefined : otherwise();
};

/** The first plan that matches. */
export const $ch = (plans) => {
  for (const plan of plans) {
    const found = plan();
    if (found !== undefined) return found;
  }
  return undefined;
};

const toText = (parts) => {
  let s = "";
  for (const part of parts)
    s += part.type === "markup" ? "" : part.type === "fallback" ? "{" + part.source + "}" : part.value;
  return s;
};

/** A message: called for its string, or through '.parts' for its parts. */
export const $message = (impls) => {
  const parts = (params, options) => {
    const requested = options === undefined || options.locale === undefined ? getLocale() : options.locale;
    const l = own(impls, requested) ? requested : baseLocale;
    const c = { l, d: own(dirs, l) ? dirs[l] : "auto", b: options === undefined || options.bidiIsolation !== "none" };
    return impls[l](c, params === undefined ? {} : params);
  };
  const format = (params, options) => toText(parts(params, options));
  format.parts = parts;
  return format;
};

const numberLiteral = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/;
const numeric = (v) => {
  const n = typeof v === "number" ? v : typeof v === "string" && numberLiteral.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) ? n : NO;
};
const oneOf = (...values) => (v) => (values.includes(v) ? v : NO);
const digits = (v) =>
  typeof v === "number"
    ? Number.isInteger(v) && v >= 0 && v <= 99
      ? v
      : NO
    : typeof v === "string" && /^(?:0|[1-9]\d?)$/.test(v)
      ? Number(v)
      : NO;
const bool = (v) => (typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : NO);
const str = (v) => (typeof v === "string" ? v : NO);
const matching = (pattern) => (v) => (typeof v === "string" && pattern.test(v) ? v : NO);
const increments = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];
const increment = (v) => {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  return increments.includes(n) ? n : NO;
};

const numberOptions = {
  signDisplay: oneOf("auto", "always", "exceptZero", "negative", "never"),
  useGrouping: oneOf("auto", "always", "never", "min2"),
  minimumIntegerDigits: digits,
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
  minimumSignificantDigits: digits,
  maximumSignificantDigits: digits,
  trailingZeroDisplay: oneOf("auto", "stripIfInteger"),
  roundingPriority: oneOf("auto", "morePrecision", "lessPrecision"),
  roundingIncrement: increment,
  roundingMode: oneOf("ceil", "floor", "expand", "trunc", "halfCeil", "halfFloor", "halfExpand", "halfTrunc", "halfEven"),
};
const select = oneOf("plural", "ordinal", "exact");

const intlOptions = (o) => {
  const r = omit(o, ["useGrouping"]);
  if (o.useGrouping !== undefined) r.useGrouping = o.useGrouping === "never" ? false : o.useGrouping;
  return r;
};

const keywords = ["zero", "one", "two", "few", "many", "other"];
const digitOptions = ["minimumIntegerDigits", "minimumFractionDigits", "minimumSignificantDigits", "maximumSignificantDigits"];
const exactOptions = digitOptions.concat(["maximumFractionDigits", "roundingPriority", "roundingIncrement", "roundingMode", "trailingZeroDisplay"]);

const selectNumber = (c, fmt, mode, value, keys) => {
  let exact;
  if (Number.isInteger(value) && digitOptions.every((k) => fmt[k] === undefined)) exact = BigInt(value).toString();
  else {
    const format = numberFormat("en", { ...pick(fmt, exactOptions), useGrouping: false });
    if (format === undefined) return undefined;
    exact = format.format(value);
  }
  let rule = "";
  if (mode !== "exact") {
    const rules = pluralRules(c.l, { ...fmt, type: mode === "ordinal" ? "ordinal" : "cardinal" });
    if (rules === undefined) return undefined;
    rule = rules.select(value);
  }
  return keys
    .filter((k) => numberLiteral.test(k) && k === exact)
    .concat(keys.filter((k) => keywords.includes(k) && k === rule));
};

const nv = (c, t, v, o, fmt, mode, selected, hide) => ({
  t,
  v,
  o,
  d: c.d,
  f: () => {
    const format = numberFormat(c.l, fmt);
    if (format === undefined) return undefined;
    const parts = format.formatToParts(v).filter((part) => hide === undefined || !hide(part));
    return { type: "number", value: parts.map((part) => part.value).join("").trim(), parts };
  },
  s: mode === undefined ? undefined : (keys) => selectNumber(c, fmt, mode, selected === undefined ? v : selected, keys),
});

const modeOf = (o, rejected) => (rejected.includes("select") ? undefined : o.select || "plural");

export const $number = {
  a: numeric,
  o: /* @__PURE__ */ merge({ select }, numberOptions),
  l: ["select"],
  r: (c, x, o, rejected) => nv(c, "number", x, o, intlOptions(omit(o, ["select"])), modeOf(o, rejected)),
};

export const $integer = {
  a: numeric,
  o: /* @__PURE__ */ merge({ select }, /* @__PURE__ */ pick(numberOptions, ["signDisplay", "useGrouping", "minimumIntegerDigits", "maximumSignificantDigits"])),
  l: ["select"],
  r: (c, x, o, rejected) =>
    nv(c, "integer", Math.trunc(x), o, { ...intlOptions(omit(o, ["select"])), maximumFractionDigits: 0 }, modeOf(o, rejected)),
};

const decodeAll = (decoders, values) => {
  const r = {};
  for (const k of Object.keys(decoders)) {
    const decoded = decoders[k](values[k]);
    if (decoded !== NO) r[k] = decoded;
  }
  return r;
};

export const $offset = {
  a: numeric,
  o: { add: digits, subtract: digits },
  r: (c, x, o, rejected, arg) => {
    if ((o.add === undefined) === (o.subtract === undefined)) return undefined;
    const delta = o.add === undefined ? -o.subtract : o.add;
    const inherited = arg === undefined ? {} : arg.o;
    const integral = arg !== undefined && arg.t === "integer";
    const fmt = intlOptions(decodeAll(numberOptions, inherited));
    return nv(
      c,
      integral ? "integer" : "number",
      x + delta,
      inherited,
      integral ? { ...fmt, maximumFractionDigits: 0 } : fmt,
      own(inherited, "select") ? undefined : "plural",
    );
  },
};

export const $percent = {
  a: numeric,
  o: /* @__PURE__ */ omit(numberOptions, ["minimumIntegerDigits", "roundingIncrement"]),
  r: (c, x, o) =>
    nv(c, "percent", x, o, { ...intlOptions(o), style: "percent" }, "plural", Number((x * 100).toPrecision(15))),
};

const currencyCode = matching(/^[A-Za-z]{3}$/);
const isSeparator = (part) => part.type === "literal" && /^[\s  ]*$/.test(part.value);

const measured = (key, decode) => (v) => {
  const n = numeric(v);
  if (n !== NO) return n;
  if (typeof v !== "object" || v === null) return NO;
  const value = numeric(v.value);
  const by = decode(v[key]);
  return value === NO || by === NO ? NO : { value, [key]: by };
};

export const $currency = {
  a: measured("currency", currencyCode),
  o: /* @__PURE__ */ merge(
    {
      currency: currencyCode,
      currencySign: oneOf("accounting", "standard"),
      currencyDisplay: oneOf("narrowSymbol", "symbol", "name", "code", "never"),
      fractionDigits: (v) => (v === "auto" ? v : digits(v)),
    },
    /* @__PURE__ */ pick(numberOptions, ["useGrouping", "minimumIntegerDigits", "minimumSignificantDigits", "maximumSignificantDigits", "trailingZeroDisplay", "roundingPriority", "roundingIncrement", "roundingMode"]),
  ),
  r: (c, x, o) => {
    const isNumber = typeof x === "number";
    if (isNumber === (o.currency === undefined)) return undefined;
    const code = (isNumber ? o.currency : x.currency).toUpperCase();
    const hidden = o.currencyDisplay === "never";
    const fraction = typeof o.fractionDigits === "number" ? o.fractionDigits : undefined;
    return nv(
      c,
      "currency",
      isNumber ? x : x.value,
      { ...o, currency: code },
      {
        ...intlOptions(omit(o, ["currencyDisplay", "fractionDigits", "currency"])),
        style: "currency",
        currency: code,
        currencyDisplay: hidden ? undefined : o.currencyDisplay,
        minimumFractionDigits: fraction,
        maximumFractionDigits: fraction,
      },
      undefined,
      undefined,
      hidden ? (part) => part.type === "currency" || isSeparator(part) : undefined,
    );
  },
};

const unitIdentifier = matching(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const $unit = {
  a: measured("unit", unitIdentifier),
  o: /* @__PURE__ */ merge(
    { unit: unitIdentifier, usage: str, unitDisplay: oneOf("short", "narrow", "long") },
    /* @__PURE__ */ omit(numberOptions, ["trailingZeroDisplay"]),
  ),
  r: (c, x, o) => {
    const isNumber = typeof x === "number";
    const measure = isNumber ? o.unit : x.unit;
    if (measure === undefined || o.usage !== undefined) return undefined;
    return nv(c, "unit", isNumber ? x : x.value, { ...o, unit: measure }, {
      ...intlOptions(omit(o, ["unit", "usage"])),
      style: "unit",
      unit: measure,
    });
  },
};

export const $string = {
  a: (v) =>
    v === undefined || typeof v === "string" || typeof v === "boolean" || typeof v === "bigint" || (typeof v === "number" && Number.isFinite(v))
      ? v
      : NO,
  o: {},
  r: (c, x) => {
    const value = x === undefined ? "" : String(x);
    const key = value.normalize("NFC");
    return {
      t: "string",
      v: value,
      o: {},
      d: "auto",
      f: () => ({ type: "string", value }),
      s: (keys) => keys.filter((k) => k === key),
    };
  },
};

const dateTimeLiteral =
  /^(?!0000)\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))?)?$/;
const instant = (v) => {
  if (!(v instanceof Date) && !(typeof v === "number" && Number.isFinite(v)) && !(typeof v === "string" && dateTimeLiteral.test(v)))
    return NO;
  const date = new Date(typeof v === "string" && !v.includes("T") ? v + "T00:00:00" : v);
  return Number.isNaN(date.getTime()) ? NO : date;
};
const fields = oneOf("weekday", "day-weekday", "month-day", "month-day-weekday", "year-month-day", "year-month-day-weekday");
const length = oneOf("long", "medium", "short");
const precision = oneOf("hour", "minute", "second");
const timeZoneStyle = oneOf("long", "short");
const calendar = matching(/^[a-z0-9]{3,8}(?:-[a-z0-9]{3,8})*$/);

const dateFormat = (set, size) => {
  const names = set.split("-");
  const has = (name) => names.includes(name);
  return {
    year: has("year") ? "numeric" : undefined,
    month: has("month") ? (size === "short" ? "numeric" : size === "medium" ? "short" : "long") : undefined,
    day: has("day") ? "numeric" : undefined,
    weekday: has("weekday") ? (size === "long" ? "long" : "short") : undefined,
  };
};
const timeFormat = (size) => ({
  hour: "numeric",
  minute: size === "hour" ? undefined : "2-digit",
  second: size === "second" ? "2-digit" : undefined,
});

const dateTime = (c, date, o, fmt) => {
  const format = dateTimeFormat(c.l, {
    ...fmt,
    timeZone: o.timeZone === "input" ? "UTC" : o.timeZone,
    calendar: o.calendar,
    hour12: o.hour12,
    timeZoneName: o.timeZoneStyle,
  });
  if (format === undefined) return undefined;
  return {
    t: "datetime",
    v: date,
    o,
    d: c.d,
    f: () => {
      const parts = format.formatToParts(date);
      return { type: "datetime", value: parts.map((part) => part.value).join(""), parts };
    },
  };
};

export const $datetime = {
  a: instant,
  o: { dateFields: fields, dateLength: length, timePrecision: precision, timeZoneStyle, hour12: bool, timeZone: str, calendar },
  l: ["dateFields", "dateLength", "timePrecision", "timeZoneStyle"],
  i: ["timeZone", "calendar", "hour12"],
  r: (c, x, o) =>
    dateTime(c, x, o, {
      ...dateFormat(o.dateFields || "year-month-day", o.dateLength || "medium"),
      ...timeFormat(o.timePrecision || "minute"),
    }),
};

export const $date = {
  a: instant,
  o: { fields, length, timeZone: str, calendar },
  l: ["fields", "length"],
  i: ["timeZone", "calendar"],
  r: (c, x, o) => dateTime(c, x, o, dateFormat(o.fields || "year-month-day", o.length || "medium")),
};

export const $time = {
  a: instant,
  o: { precision, timeZoneStyle, hour12: bool, timeZone: str, calendar },
  l: ["precision", "timeZoneStyle"],
  i: ["timeZone", "calendar", "hour12"],
  r: (c, x, o) => dateTime(c, x, o, timeFormat(o.precision || "minute")),
};
`;

/** The functions `internal.js` implements, by MessageFormat name. */
export const functions: ReadonlyArray<string> = [
  "string",
  "number",
  "integer",
  "offset",
  "percent",
  "currency",
  "unit",
  "datetime",
  "date",
  "time",
];

/** `internal.js`, given each locale's direction. */
export const formatModule = (directions: string): string =>
  `// Generated by effect-l10n. Do not edit.
import { baseLocale, getLocale } from "./runtime.js";

const dirs = ${directions};

${helpers}`;

/** `internal.d.ts`: loose types for the helpers, which `.ts` output type-checks against. */
export const formatDeclarations = `// Generated by effect-l10n. Do not edit.
import type { Message, Part } from "./runtime.js";

export interface Context {
  readonly l: string;
  readonly d: string;
  readonly b: boolean;
}
export type Value = object;
export type Def = object;
export type Option = readonly [0, Value] | readonly [1, string];
export type Options = Readonly<Record<string, Option>>;
export type Parts = Array<Part<string>>;
export type Impl = (c: Context, p: Readonly<Record<string, unknown>>) => Parts;

export declare const $lit: (value: string) => Value;
export declare const $param: (c: Context, p: Readonly<Record<string, unknown>>, name: string) => Value;
export declare const $bind: (v: Value, source: string) => Value;
export declare const $call: (c: Context, def: Def | undefined, operand: Value | undefined, options: Options, source: string, dir?: Option, id?: Option) => Value;
export declare const $ph: (c: Context, v: Value, source: string) => Parts;
export declare const $mk: (kind: "open" | "close" | "standalone", name: string, options: Options, id?: Option) => Parts;
export declare const $out: (items: ReadonlyArray<string | Parts>) => Parts;
export declare const $sw: (v: Value, keys: ReadonlyArray<string>, cases: ReadonlyArray<() => Parts | undefined>, otherwise?: () => Parts | undefined) => Parts | undefined;
export declare const $ch: (plans: ReadonlyArray<() => Parts | undefined>) => Parts | undefined;
export declare const $message: <P, M extends string>(impls: Readonly<Record<string, Impl>>) => Message<P, M>;
export declare const $string: Def;
export declare const $number: Def;
export declare const $integer: Def;
export declare const $offset: Def;
export declare const $percent: Def;
export declare const $currency: Def;
export declare const $unit: Def;
export declare const $datetime: Def;
export declare const $date: Def;
export declare const $time: Def;
`;
