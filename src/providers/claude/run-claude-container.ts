import type { Runtime, GitIdentity } from "../../types"
import { CLAUDE_DIR } from "../../constants"
import { spawnContainer } from "../../utils/container"
import { resolveClaudeCredentials } from "./credentials"
import { CLAUDE_PROVIDER_SPEC } from "./spec"

/** Options the orchestrator passes to runClaudeContainer. */
export interface RunClaudeContainerOptions {
  runtime: Runtime
  workDir: string
  command: string | null
  gitConfig: GitIdentity | null
}

/**
 * Runs the Claude container: resolves the host's Claude credentials, mounts
 * ~/.claude read-only at /home/viber/.claude-host, injects CLAUDE_CREDENTIALS,
 * and delegates the actual spawn to the generic helper.
 */
export async function runClaudeContainer(options: RunClaudeContainerOptions): Promise<number> {
  const credentialsJson = await resolveClaudeCredentials()

  const extraEnv: Record<string, string> = {}
  if(credentialsJson) {
    // entrypoint.ts reads this and writes credentials inside the container —
    // nothing is ever written back to the host's ~/.claude.
    extraEnv.CLAUDE_CREDENTIALS = credentialsJson
  }

  return spawnContainer({
    runtime: options.runtime,
    spec: CLAUDE_PROVIDER_SPEC,
    workDir: options.workDir,
    gitConfig: options.gitConfig,
    command: options.command,
    extraEnv,
    extraMounts: [[CLAUDE_DIR, "/home/viber/.claude-host", "ro"]]
  })
}
