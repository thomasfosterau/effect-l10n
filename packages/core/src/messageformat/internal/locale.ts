import * as Arr from "effect/Array";
import * as Result from "effect/Result";
import type { Direction } from "../MessageValue";

const rtlScripts = ["Adlm", "Arab", "Hebr", "Mand", "Mend", "Nkoo", "Rohg", "Samr", "Syrc", "Thaa"];

/** A locale's direction, from its likely script; `auto` if it doesn't parse. */
export const localeDirection = (locale: string): Direction =>
  Result.match(
    Result.try(() => new Intl.Locale(locale).maximize().script),
    {
      onFailure: () => "auto",
      onSuccess: (script) =>
        script === undefined ? "auto" : Arr.contains(rtlScripts, script) ? "rtl" : "ltr",
    },
  );
