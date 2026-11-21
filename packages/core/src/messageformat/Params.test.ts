import { assert, describe, it } from "@effect/vitest";
import * as Result from "effect/Result";
import { expectTypeOf } from "vite-plus/test";
import type { MessageFunction } from "./MessageFunction";
import type { ResolvedOptions } from "./MessageValue";
import {
  type DefaultOperands,
  type MarkupOf,
  markup,
  type OperandOf,
  params,
  type ParamsOf,
} from "./Params";
import { parseResult } from "./Parser";

const parse = (source: string) =>
  Result.match(parseResult(source), {
    onFailure: (error) => assert.fail(error.message),
    onSuccess: (message) => message,
  });

describe("ParamsOf", () => {
  it("types simple messages", () => {
    expectTypeOf<ParamsOf<"Hello, world!">>().toEqualTypeOf<Record<string, never>>();
    expectTypeOf<ParamsOf<"Hello, {$name}!">>().toEqualTypeOf<{
      readonly name: string | number | boolean | bigint;
    }>();
    expectTypeOf<ParamsOf<"{$count :number} files in {$folder :string}">>().toEqualTypeOf<{
      readonly count: number;
      readonly folder: string | number | boolean | bigint;
    }>();
  });

  it("types plural and select messages", () => {
    type Plural =
      ParamsOf<".input {$count :integer} .match $count one {{One file}} * {{{$count} files}}">;
    expectTypeOf<Plural>().toEqualTypeOf<{ readonly count: number }>();
    type Select =
      ParamsOf<".input {$host :string} .input {$guests :number} .match $host $guests * one {{{$host} and a guest}} * * {{{$host} and {$guests} guests}}">;
    expectTypeOf<Select>().toEqualTypeOf<{
      readonly host: string | number | boolean | bigint;
      readonly guests: number;
    }>();
  });

  it("leaves locals out and reads their operands and options", () => {
    type Nested =
      ParamsOf<".local $others = {$count :offset subtract=1} .local $digits = {2} {{{$others :number minimumFractionDigits=$digits} and {$name}}}">;
    expectTypeOf<Nested>().toEqualTypeOf<{
      readonly count: number;
      readonly name: string | number | boolean | bigint;
    }>();
  });

  it("intersects the types a variable is read as", () => {
    expectTypeOf<ParamsOf<"{$n} = {$n :number}">>().toEqualTypeOf<{ readonly n: number }>();
  });

  it("types dates and quoted patterns", () => {
    expectTypeOf<ParamsOf<"{{Due {$when :date}}}">>().toEqualTypeOf<{
      readonly when: string | number | Date;
    }>();
    expectTypeOf<ParamsOf<"Escaped \\{$not} {$real}">>().toHaveProperty("real");
    expectTypeOf<ParamsOf<"Escaped \\{$not} {$real}">>().not.toHaveProperty("not");
  });

  it("takes custom functions' operand types", () => {
    type Gender = MessageFunction<"masculine" | "feminine" | "other">;
    type Operands = DefaultOperands & { readonly "ns:gender": OperandOf<Gender> };
    expectTypeOf<ParamsOf<"{$who :ns:gender}", Operands>>().toEqualTypeOf<{
      readonly who: "masculine" | "feminine" | "other";
    }>();
    expectTypeOf<ParamsOf<"{$who :ns:unknown}">>().toEqualTypeOf<{ readonly who: unknown }>();
  });

  it("falls back to a record for a non-literal string", () => {
    expectTypeOf<ParamsOf<string>>().toEqualTypeOf<ResolvedOptions>();
  });
});

describe("MarkupOf", () => {
  it("names a message's markup", () => {
    expectTypeOf<MarkupOf<"{#b}bold{/b} and {#link href=$url}a link{/link}{#br/}">>().toEqualTypeOf<
      "b" | "link" | "br"
    >();
    expectTypeOf<MarkupOf<"{#ns:tag}x{/ns:tag}">>().toEqualTypeOf<"ns:tag">();
    expectTypeOf<MarkupOf<"no markup">>().toBeNever();
  });
});

describe("params", () => {
  it("lists parameters with their functions, without locals", () => {
    const message = parse(
      ".input {$count :integer} .local $others = {$count :offset subtract=1} .match $count one {{{$name}}} * {{{$others :number minimumFractionDigits=$digits} {$name :string}}}",
    );
    assert.deepStrictEqual(params(message), [
      { name: "count", functions: ["integer", "offset"] },
      { name: "name", functions: ["string"] },
      { name: "digits", functions: [] },
    ]);
  });

  it("lists markup names", () => {
    assert.deepStrictEqual(markup(parse("{#b}x{/b}{#link href=$url /}")), ["b", "link"]);
  });
});
