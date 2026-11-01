import type { Runtime, GitIdentity, ProviderSpec } from "../../types"
import { spawnContainer } from "../../utils/container"
import { resolveCodexCredentials } from "./credentials"
import { withCodexImports } from "./imports"

/** Options the orchestrator passes to runCodexContainer. */
export interface RunCodexContainerOptions {
  runtime: Runtime
  spec: ProviderSpec
  workDir: string
  command: string | null
  gitConfig: GitIdentity | null
}

/** Runs Codex with injected credentials and disposable configuration imports. */
export async function runCodexContainer(options: RunCodexContainerOptions): Promise<number> {
  const credentialsJson = await resolveCodexCredentials()

  const extraEnv: Record<string, string> = {}
  if(credentialsJson) {
    // The entrypoint writes auth.json inside the container; the host's ~/.codex is untouched.
    extraEnv.CODEX_CREDENTIALS = credentialsJson
  }

  return withCodexImports(directory => spawnContainer({
    runtime: options.runtime,
    spec: options.spec,
    workDir: options.workDir,
    gitConfig: options.gitConfig,
    command: options.command,
    extraEnv,
    extraMounts: [[directory, "/home/viber/.codex-import", "ro"]]
  }))
}
