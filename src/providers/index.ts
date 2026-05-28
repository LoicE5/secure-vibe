import type { ProviderId, ProviderRunner } from "../types"
import { runClaudeContainer } from "./claude/run-claude-container"

/** Registry mapping each ProviderId to its container runner. */
export const PROVIDER_RUNNERS: Partial<Record<ProviderId, ProviderRunner>> = {
  claude: runClaudeContainer
  // Future: codex: runCodexContainer, mistral: runMistralContainer, ccr: runCcrContainer
}

/**
 * Returns the runner registered for `providerId`, or exits the process (code 1)
 * with a helpful message if it isn't implemented yet.
 */
export function resolveProviderRunner(providerId: ProviderId): ProviderRunner {
  const runner = PROVIDER_RUNNERS[providerId]
  if(!runner) {
    console.error(`✗ Provider '${providerId}' is not implemented yet.`)
    process.exit(1)
  }
  return runner
}
