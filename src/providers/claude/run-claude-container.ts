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

/** Runs the Claude container with the host's credentials and ~/.claude mounted read-only. */
export async function runClaudeContainer(options: RunClaudeContainerOptions): Promise<number> {
  const credentialsJson = await resolveClaudeCredentials()

  const extraEnv: Record<string, string> = {}
  if(credentialsJson) {
    // The entrypoint writes these inside the container; the host's ~/.claude is never touched.
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
