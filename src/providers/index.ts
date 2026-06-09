import type { ProviderId, ProviderRunner, ProviderSpec } from "../types"
import { runClaudeContainer } from "./claude/run-claude-container"
import { CLAUDE_PROVIDER_SPEC } from "./claude/spec"
import { runAntigravityContainer } from "./antigravity/run-antigravity-container"
import { ANTIGRAVITY_PROVIDER_SPEC } from "./antigravity/spec"
import { runCcrContainer } from "./ccr/run-ccr-container"
import { CCR_PROVIDER_SPEC } from "./ccr/spec"

/** Registry mapping each ProviderId to its container runner. */
export const PROVIDER_RUNNERS: Partial<Record<ProviderId, ProviderRunner>> = {
  claude: runClaudeContainer,
  antigravity: runAntigravityContainer,
  ccr: runCcrContainer
}

/** Registry mapping each ProviderId to its static spec (image, dockerfile, brew volume). */
export const PROVIDER_SPECS: Partial<Record<ProviderId, ProviderSpec>> = {
  claude: CLAUDE_PROVIDER_SPEC,
  antigravity: ANTIGRAVITY_PROVIDER_SPEC,
  ccr: CCR_PROVIDER_SPEC
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

/**
 * Returns the spec registered for `providerId`, or exits the process (code 1)
 * if it isn't implemented yet. Used by the generic image helpers.
 */
export function resolveProviderSpec(providerId: ProviderId): ProviderSpec {
  const spec = PROVIDER_SPECS[providerId]
  if(!spec) {
    console.error(`✗ Provider '${providerId}' is not implemented yet.`)
    process.exit(1)
  }
  return spec
}
