import * as Catalog from "../../../../Catalog";
import * as Message from "../../../../Message";

export const checkout = Catalog.make({
  total: Message.make("Total: {$amount :currency currency=EUR}"),
  broken: Message.make("Unclosed {$placeholder"),
});
