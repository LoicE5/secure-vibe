import { runOpenCodeContainer } from "../../src/providers/opencode/run-opencode-container"
import { resolveProviderSpec } from "../../src/providers"

process.exit(await runOpenCodeContainer({
  runtime: "docker",
  spec: resolveProviderSpec("opencode"),
  workDir: process.argv.at(2)!,
  command: process.argv.at(3) ?? null,
  gitConfig: { name: "Test User", email: "test@example.invalid" }
}))
