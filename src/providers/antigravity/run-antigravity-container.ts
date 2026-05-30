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
 * Runs the Antigravity container: resolves the host's agy credentials, mounts
 * ~/.config/agy and ~/.gemini read-only (entrypoint.ts mirrors them into writable
 * copies and injects the sandbox prompt into ~/.gemini/GEMINI.md), and delegates
 * the actual spawn to the generic helper. Nothing is ever written back to the host.
 */
export async function runAntigravityContainer(options: RunAntigravityContainerOptions): Promise<number> {
  const credentials = await resolveAntigravityCredentials()

  const extraEnv: Record<string, string> = {}
  if(credentials.apiKey) {
    extraEnv.ANTIGRAVITY_API_KEY = credentials.apiKey
  }

  // Only mount host config dirs that actually exist — passing a missing host path to
  // `-v` would create an empty root-owned directory on the host.
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
