import { access } from "fs/promises"
import { homedir } from "os"
import type { Runtime, GitIdentity } from "../../types"
import { VIBE_DIR } from "../../constants"
import { spawnContainer, type ExtraMount } from "../../utils/container"
import { resolveVibeCredentials } from "./credentials"
import { VIBE_PROVIDER_SPEC } from "./spec"

/** Options the orchestrator passes to runVibeContainer. */
export interface RunVibeContainerOptions {
  runtime: Runtime
  workDir: string
  command: string | null
  gitConfig: GitIdentity | null
}

/**
 * Runs the Mistral Vibe container: resolves the host's Mistral API key, mounts
 * ~/.vibe read-only at /home/viber/.vibe-host (only when it exists — an env-key-only
 * host may not have one), injects MISTRAL_API_KEY, and delegates the actual spawn
 * to the generic helper.
 */
export async function runVibeContainer(options: RunVibeContainerOptions): Promise<number> {
  const apiKey = await resolveVibeCredentials()

  // vibe reads MISTRAL_API_KEY process-env-first, so it beats anything mirrored from the
  // host. SECURE_VIBE_HOST_HOME lets the entrypoint remap host paths baked into config.toml.
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
    spec: VIBE_PROVIDER_SPEC,
    workDir: options.workDir,
    gitConfig: options.gitConfig,
    command: options.command,
    extraEnv,
    extraMounts
  })
}
