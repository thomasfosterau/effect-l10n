import * as Message from "@thomasfosterau/effect-l10n/Message";

export const greeting = Message.make("Hello, {$name}!");

export const broken = Message.make("Hello, {$name");
