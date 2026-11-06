import { packageConfig } from "../../vite.package";

// One `vp pack` entry per `exports` subpath (ADR 0007).
export default packageConfig({
  index: "src/index.ts",
  "messageformat/index": "src/messageformat/index.ts",
  "compiler/index": "src/compiler/index.ts",
});
