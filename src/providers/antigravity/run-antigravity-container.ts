import { access } from "fs/promises"
import type { Runtime, GitIdentity } from "../../types"
import { AGY_CONFIG_DIR, GEMINI_DIR } from "../../constants"
import { spawnContainer } from "../../utils/container"
import type { ExtraMount } from "../../utils/container"
import { resolveAntigravityCredentials } from "./credentials"
import { ANTIGRAVITY_PROVIDER_SPEC } from "./spec"

/** Options the orchestrator passes to runAntigravityContainer. */
export interface RunAntigravityContainerOptions {
  runtime: Runtime
  workDir: string
  command: string | null
  gitConfig: GitIdentity | null
}

/**
 * Mounts ~/.gemini (and ~/.config/agy when present) read-only, injects an optional
 * ANTIGRAVITY_API_KEY, and delegates the spawn. entrypoint.ts handles the rest.
 */
export async function runAntigravityContainer(options: RunAntigravityContainerOptions): Promise<number> {
  const credentials = await resolveAntigravityCredentials()

  const extraEnv: Record<string, string> = {}
  if(credentials.apiKey) {
    extraEnv.ANTIGRAVITY_API_KEY = credentials.apiKey
  }

  // Skip mounts whose host path is missing — `-v` would create an empty root-owned dir.
  const candidateMounts: ReadonlyArray<ExtraMount> = [
    [AGY_CONFIG_DIR, "/home/viber/.config/agy-host", "ro"],
    [GEMINI_DIR, "/home/viber/.gemini-host", "ro"]
  ]
  const extraMounts: ExtraMount[] = []
  for(const mount of candidateMounts) {
    const hostExists = await access(mount[0]).then(() => true).catch(() => false)
    if(hostExists) extraMounts.push(mount)
  }

  return spawnContainer({
    runtime: options.runtime,
    spec: ANTIGRAVITY_PROVIDER_SPEC,
    workDir: options.workDir,
    gitConfig: options.gitConfig,
    command: options.command,
    extraEnv,
    extraMounts
  })
}
