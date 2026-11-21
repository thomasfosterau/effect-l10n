import { packageConfig } from "../../vite.package";

export default packageConfig({
  index: "src/index.ts",
  "messageformat/index": "src/messageformat/index.ts",
  "messageformat/DataModel": "src/messageformat/DataModel.ts",
  "messageformat/MessageFormatError": "src/messageformat/MessageFormatError.ts",
  "messageformat/Parser": "src/messageformat/Parser.ts",
  "compiler/index": "src/compiler/index.ts",
});
