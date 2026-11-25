import * as Message from "../../../../Message";

export const greeting = Message.make("Hello, {$name}!", { description: "The dashboard header" });

export const items = Message.make(
  ".input {$count :integer} .match $count 0 {{No items}} one {{One item}} * {{{$count} items}}",
);

export const invite = Message.make(
  `.input {$host :string}
.match $host
  alex {{Alex invited you}}
  * {{{$host} invited you}}`,
);

export const broken = Message.make(`Welcome back,
  {$name :string} and {$oops`);
