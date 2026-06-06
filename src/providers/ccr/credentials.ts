import { readClaudeJson } from "../claude/credentials"

/**
 * Best-effort Anthropic credentials for CCR.
 *
 * CCR routes Claude Code to whatever model its config.json names — which may be
 * entirely non-Anthropic (GLM, OpenRouter, Ollama, …). So unlike the claude provider,
 * we MUST NOT exit when no Anthropic credentials exist. We only opportunistically reuse
 * the host's ~/.claude.json (via the claude provider's readClaudeJson) so that a CCR
 * route pointing back at Anthropic starts pre-authenticated. Returns null otherwise.
 */
export async function resolveCcrAnthropicCredentials(): Promise<string | null> {
  return await readClaudeJson()
}
