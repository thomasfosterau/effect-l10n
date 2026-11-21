import { packageConfig } from "../../vite.package";

export default packageConfig({
  index: "src/index.ts",
  "messageformat/index": "src/messageformat/index.ts",
  "messageformat/DataModel": "src/messageformat/DataModel.ts",
  "compiler/index": "src/compiler/index.ts",
});
