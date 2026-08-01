import { access } from "fs/promises"
import { homedir } from "os"
import type { Runtime, GitIdentity, ProviderSpec } from "../../types"
import { VIBE_DIR } from "../../constants"
import { spawnContainer, type ExtraMount } from "../../utils/container"
import { resolveVibeCredentials } from "./credentials"

/** Options the orchestrator passes to runVibeContainer. */
export interface RunVibeContainerOptions {
  runtime: Runtime
  spec: ProviderSpec
  workDir: string
  command: string | null
  gitConfig: GitIdentity | null
}

/** Runs the Vibe container with the host's API key and ~/.vibe mounted read-only if present. */
export async function runVibeContainer(options: RunVibeContainerOptions): Promise<number> {
  const apiKey = await resolveVibeCredentials()

  // vibe reads MISTRAL_API_KEY process-env-first, so it beats anything mirrored from the host.
  const extraEnv: Record<string, string> = {
    MISTRAL_API_KEY: apiKey,
    SECURE_VIBE_HOST_HOME: homedir()
  }

  const vibeDirExists = await access(VIBE_DIR).then(() => true).catch(() => false)
  const extraMounts: ExtraMount[] = vibeDirExists
    ? [[VIBE_DIR, "/home/viber/.vibe-host", "ro"]]
    : []

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
