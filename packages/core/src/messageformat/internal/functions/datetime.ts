import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { BadOperand, BadOption, type FunctionError } from "../../MessageFormatError";
import * as MessageFunction from "../../MessageFunction";
import type { MessageValue, ResolvedOptions } from "../../MessageValue";
import { localeDirection } from "../locale";
import { BooleanOption } from "../options";

// The spec's date/time literal. Without a time it means midnight, and without
// an offset it is local ("floating") time.
const dateTimeLiteral =
  /^(?!0000)\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))?)?$/;

/** A date/time operand: a `Date`, a timestamp in milliseconds or a date/time literal. */
const DateTimeOperand = Schema.Union([
  Schema.Date,
  Schema.Finite,
  Schema.String.check(Schema.isPattern(dateTimeLiteral, { identifier: "DateTimeLiteral" })),
]);

/** The instant an operand names, if it names a real one (not 2006-02-31). */
const instant = (operand: typeof DateTimeOperand.Type): Option.Option<Date> =>
  Option.map(
    DateTime.make(P.isString(operand) && !operand.includes("T") ? `${operand}T00:00:00` : operand),
    DateTime.toDateUtc,
  );

const fields = Schema.Literals([
  "weekday",
  "day-weekday",
  "month-day",
  "month-day-weekday",
  "year-month-day",
  "year-month-day-weekday",
]);
const length = Schema.Literals(["long", "medium", "short"]);
const precision = Schema.Literals(["hour", "minute", "second"]);
const timeZoneStyle = Schema.Literals(["long", "short"]);

const overrides = {
  timeZone: Schema.String,
  calendar: Schema.String.check(
    Schema.isPattern(/^[a-z0-9]{3,8}(?:-[a-z0-9]{3,8})*$/, { identifier: "CalendarIdentifier" }),
  ),
};

type Fields = typeof fields.Type;
type Length = typeof length.Type;
type Precision = typeof precision.Type;

const dateFormat = (set: Fields, size: Length): Intl.DateTimeFormatOptions => {
  const names = set.split("-");
  const has = (name: string) => Arr.contains(names, name);
  return {
    year: has("year") ? "numeric" : undefined,
    month: has("month")
      ? size === "short"
        ? "numeric"
        : size === "medium"
          ? "short"
          : "long"
      : undefined,
    day: has("day") ? "numeric" : undefined,
    weekday: has("weekday") ? (size === "long" ? "long" : "short") : undefined,
  };
};

const timeFormat = (size: Precision): Intl.DateTimeFormatOptions => ({
  hour: "numeric",
  minute: size === "hour" ? undefined : "2-digit",
  second: size === "second" ? "2-digit" : undefined,
});

interface Overrides {
  readonly timeZone?: string;
  readonly calendar?: string;
  readonly hour12?: BooleanOption;
  readonly timeZoneStyle?: typeof timeZoneStyle.Type;
}

const overrideFormat = (options: Overrides): Intl.DateTimeFormatOptions => ({
  // A `Date` is an instant, so its own time zone is UTC.
  timeZone: options.timeZone === "input" ? "UTC" : options.timeZone,
  calendar: options.calendar,
  hour12: options.hour12,
  timeZoneName: options.timeZoneStyle,
});

const dateTimeValue = (
  name: string,
  context: MessageFunction.FunctionContext,
  operand: typeof DateTimeOperand.Type,
  options: Overrides & ResolvedOptions,
  format: Intl.DateTimeFormatOptions,
): Result.Result<MessageValue, FunctionError> =>
  Result.flatMap(
    Result.fromOption(instant(operand), () => new BadOperand({ function: name })),
    (value) => dateTimeFormat(name, context, value, options, format),
  );

const dateTimeFormat = (
  name: string,
  context: MessageFunction.FunctionContext,
  value: Date,
  options: Overrides & ResolvedOptions,
  format: Intl.DateTimeFormatOptions,
): Result.Result<MessageValue, FunctionError> =>
  Result.map(
    Result.mapError(
      context.intl.dateTimeFormat(context.locale, { ...format, ...overrideFormat(options) }),
      // Intl rejects only the free-form time zone and calendar options.
      () => new BadOption({ function: name, option: "timeZone" }),
    ),
    (formatter) => ({
      type: "datetime",
      locale: context.locale,
      dir: localeDirection(context.locale),
      value,
      options,
      format: Option.some(() => {
        const parts = formatter.formatToParts(value);
        return Result.succeed({
          type: "datetime",
          value: Arr.join(
            Arr.map(parts, (part) => part.value),
            "",
          ),
          parts,
        });
      }),
      select: Option.none(),
    }),
  );

const inherit = ["timeZone", "calendar", "hour12"] as const;

/** `:datetime` (draft): formats a date and a time. */
export const datetime = MessageFunction.make({
  name: "datetime",
  status: "draft",
  operand: DateTimeOperand,
  options: {
    dateFields: fields,
    dateLength: length,
    timePrecision: precision,
    timeZoneStyle,
    hour12: BooleanOption,
    ...overrides,
  },
  literal: ["dateFields", "dateLength", "timePrecision", "timeZoneStyle"],
  inherit,
  resolve: ({ context, operand, options }) =>
    dateTimeValue("datetime", context, operand, options, {
      ...dateFormat(options.dateFields ?? "year-month-day", options.dateLength ?? "medium"),
      ...timeFormat(options.timePrecision ?? "minute"),
    }),
});

/** `:date` (draft): formats a date. */
export const date = MessageFunction.make({
  name: "date",
  status: "draft",
  operand: DateTimeOperand,
  options: { fields, length, ...overrides },
  literal: ["fields", "length"],
  inherit: ["timeZone", "calendar"],
  resolve: ({ context, operand, options }) =>
    dateTimeValue(
      "date",
      context,
      operand,
      options,
      dateFormat(options.fields ?? "year-month-day", options.length ?? "medium"),
    ),
});

/** `:time` (draft): formats a time. */
export const time = MessageFunction.make({
  name: "time",
  status: "draft",
  operand: DateTimeOperand,
  options: { precision, timeZoneStyle, hour12: BooleanOption, ...overrides },
  literal: ["precision", "timeZoneStyle"],
  inherit,
  resolve: ({ context, operand, options }) =>
    dateTimeValue("time", context, operand, options, timeFormat(options.precision ?? "minute")),
});
