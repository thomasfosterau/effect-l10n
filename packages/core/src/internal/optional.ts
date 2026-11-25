import * as Option from "effect/Option";
import * as R from "effect/Record";

/** `{ [key]: value }` when `value` is present, else `{}`: an optional key under `exactOptionalPropertyTypes`. */
export const optionalKey = <K extends string, A>(
  key: K,
  value: Option.Option<A>,
): Partial<Record<K, A>> =>
  Option.match(value, {
    onNone: () => ({}),
    onSome: (present) => R.singleton(key, present),
  });
