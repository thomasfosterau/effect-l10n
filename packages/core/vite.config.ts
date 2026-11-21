import { packageConfig } from "../../vite.package";

export default packageConfig({
  index: "src/index.ts",
  "messageformat/index": "src/messageformat/index.ts",
  "messageformat/DataModel": "src/messageformat/DataModel.ts",
  "messageformat/FunctionRegistry": "src/messageformat/FunctionRegistry.ts",
  "messageformat/MessageFormatError": "src/messageformat/MessageFormatError.ts",
  "messageformat/MessageFunction": "src/messageformat/MessageFunction.ts",
  "messageformat/MessageValue": "src/messageformat/MessageValue.ts",
  "messageformat/Parser": "src/messageformat/Parser.ts",
  "messageformat/Serializer": "src/messageformat/Serializer.ts",
  "messageformat/Validation": "src/messageformat/Validation.ts",
  "compiler/index": "src/compiler/index.ts",
});
