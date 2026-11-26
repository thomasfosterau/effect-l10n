// Compiles the messages to generated/l10n/web.
import { compile } from "@thomasfosterau/effect-l10n-node/NodeCompiler";

const { ok, report } = await compile({ cwd: import.meta.dirname });
process.stdout.write(report);
if (!ok) process.exitCode = 1;
