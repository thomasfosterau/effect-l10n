import * as Message from "@thomasfosterau/effect-l10n/Message";

export const title = Message.make("Welcome, {$name}", { description: "The page heading" });

export const visits = Message.make(
  ".input {$count :integer} .match $count 0 {{No visits yet}} one {{{#b}One{/b} visit}} * {{{#b}{$count}{/b} visits}}",
);

export const about = Message.make("About us");
