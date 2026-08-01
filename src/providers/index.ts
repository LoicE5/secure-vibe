import type { ProviderId, ProviderRunner, ProviderSpec } from "../types"
import { toDindSpec } from "../utils/dind"
import { runClaudeContainer } from "./claude/run-claude-container"
import { CLAUDE_PROVIDER_SPEC } from "./claude/spec"
import { runAntigravityContainer } from "./antigravity/run-antigravity-container"
import { ANTIGRAVITY_PROVIDER_SPEC } from "./antigravity/spec"
import { runCcrContainer } from "./ccr/run-ccr-container"
import { CCR_PROVIDER_SPEC } from "./ccr/spec"
import { runCodexContainer } from "./codex/run-codex-container"
import { CODEX_PROVIDER_SPEC } from "./codex/spec"
import { runVibeContainer } from "./vibe/run-vibe-container"
import { VIBE_PROVIDER_SPEC } from "./vibe/spec"

/** Registry mapping each ProviderId to its container runner. */
export const PROVIDER_RUNNERS: Partial<Record<ProviderId, ProviderRunner>> = {
  claude: runClaudeContainer,
  antigravity: runAntigravityContainer,
  ccr: runCcrContainer,
  codex: runCodexContainer,
  vibe: runVibeContainer
}

/** Registry mapping each ProviderId to its static spec (image, dockerfile, brew volume). */
export const PROVIDER_SPECS: Partial<Record<ProviderId, ProviderSpec>> = {
  claude: CLAUDE_PROVIDER_SPEC,
  antigravity: ANTIGRAVITY_PROVIDER_SPEC,
  ccr: CCR_PROVIDER_SPEC,
  codex: CODEX_PROVIDER_SPEC,
  vibe: VIBE_PROVIDER_SPEC
}

/** Returns the runner for `providerId`, or exits (code 1) if it isn't implemented. */
export function resolveProviderRunner(providerId: ProviderId): ProviderRunner {
  const runner = PROVIDER_RUNNERS[providerId]
  if(!runner) {
    console.error(`✗ Provider '${providerId}' is not implemented yet.`)
    process.exit(1)
  }
  return runner
}

/** Returns the spec for `providerId`, or exits (code 1) if it isn't implemented. */
export function resolveProviderSpec(providerId: ProviderId, dind = false): ProviderSpec {
  const spec = PROVIDER_SPECS[providerId]
  if(!spec) {
    console.error(`✗ Provider '${providerId}' is not implemented yet.`)
    process.exit(1)
  }
  return dind ? toDindSpec(spec) : spec
}
