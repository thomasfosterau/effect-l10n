import { expect, test } from "vite-plus/test";
import { name } from "./index";

test("exports name", () => {
  expect(name).toBe("effect-l10n");
});
