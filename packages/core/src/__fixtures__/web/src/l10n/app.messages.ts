import * as Message from "../../../../Message";

export const greeting = Message.make("Hello, {$name}!", {
  description: "Shown on the dashboard header",
  maxLength: 40,
});

export const items = Message.make(
  ".input {$count :integer} .match $count one {{One item}} * {{{$count} items}}",
);

export const brand = Message.make("Acme", { doNotTranslate: true });
