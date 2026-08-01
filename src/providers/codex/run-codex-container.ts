import type { Runtime, GitIdentity, ProviderSpec } from "../../types"
import { CODEX_DIR } from "../../constants"
import { spawnContainer } from "../../utils/container"
import { resolveCodexCredentials } from "./credentials"

/** Options the orchestrator passes to runCodexContainer. */
export interface RunCodexContainerOptions {
  runtime: Runtime
  spec: ProviderSpec
  workDir: string
  command: string | null
  gitConfig: GitIdentity | null
}

/** Runs the Codex container with the host's auth and ~/.codex mounted read-only. */
export async function runCodexContainer(options: RunCodexContainerOptions): Promise<number> {
  const credentialsJson = await resolveCodexCredentials()

  const extraEnv: Record<string, string> = {}
  if(credentialsJson) {
    // The entrypoint writes auth.json inside the container; the host's ~/.codex is untouched.
    extraEnv.CODEX_CREDENTIALS = credentialsJson
  }

  return spawnContainer({
    runtime: options.runtime,
    spec: options.spec,
    workDir: options.workDir,
    gitConfig: options.gitConfig,
    command: options.command,
    extraEnv,
    extraMounts: [[CODEX_DIR, "/home/viber/.codex-host", "ro"]]
  })
}
