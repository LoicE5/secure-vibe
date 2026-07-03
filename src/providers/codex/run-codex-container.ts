import type { Runtime, GitIdentity } from "../../types"
import { CODEX_DIR } from "../../constants"
import { spawnContainer } from "../../utils/container"
import { resolveCodexCredentials } from "./credentials"
import { CODEX_PROVIDER_SPEC } from "./spec"

/** Options the orchestrator passes to runCodexContainer. */
export interface RunCodexContainerOptions {
  runtime: Runtime
  workDir: string
  command: string | null
  gitConfig: GitIdentity | null
}

/**
 * Runs the Codex container: resolves the host's Codex auth, mounts
 * ~/.codex read-only at /home/viber/.codex-host, injects CODEX_CREDENTIALS,
 * and delegates the actual spawn to the generic helper.
 */
export async function runCodexContainer(options: RunCodexContainerOptions): Promise<number> {
  const credentialsJson = await resolveCodexCredentials()

  const extraEnv: Record<string, string> = {}
  if(credentialsJson) {
    // entrypoint.ts reads this and writes auth.json inside the container —
    // nothing is ever written back to the host's ~/.codex.
    extraEnv.CODEX_CREDENTIALS = credentialsJson
  }

  return spawnContainer({
    runtime: options.runtime,
    spec: CODEX_PROVIDER_SPEC,
    workDir: options.workDir,
    gitConfig: options.gitConfig,
    command: options.command,
    extraEnv,
    extraMounts: [[CODEX_DIR, "/home/viber/.codex-host", "ro"]]
  })
}
