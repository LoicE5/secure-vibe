import { access } from "fs/promises"
import type { Runtime, GitIdentity, ProviderSpec } from "../../types"
import { GEMINI_DIR } from "../../constants"
import { spawnContainer } from "../../utils/container"
import type { ExtraMount } from "../../utils/container"
import { resolveAntigravityCredentials } from "./credentials"

/** Options the orchestrator passes to runAntigravityContainer. */
export interface RunAntigravityContainerOptions {
  runtime: Runtime
  spec: ProviderSpec
  workDir: string
  command: string | null
  gitConfig: GitIdentity | null
}

/** Runs the agy container with the host token injected and ~/.gemini mounted read-only. */
export async function runAntigravityContainer(options: RunAntigravityContainerOptions): Promise<number> {
  const creds = await resolveAntigravityCredentials()

  const extraEnv: Record<string, string> = {}
  if(creds.token) extraEnv.AGY_OAUTH_TOKEN = creds.token
  if(creds.apiKey) extraEnv.ANTIGRAVITY_API_KEY = creds.apiKey

  // Skipped when missing, or `-v` would create an empty root-owned dir.
  const extraMounts: ExtraMount[] = []
  const geminiExists = await access(GEMINI_DIR).then(() => true).catch(() => false)
  if(geminiExists) extraMounts.push([GEMINI_DIR, "/home/viber/.gemini-host", "ro"])

  return spawnContainer({
    runtime: options.runtime,
    spec: options.spec,
    workDir: options.workDir,
    gitConfig: options.gitConfig,
    command: options.command,
    extraEnv,
    extraMounts
  })
}
