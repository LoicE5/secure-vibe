import type { ProviderRunner } from "../../types"
import { spawnContainer } from "../../utils/container"
import { loadDotEnv } from "../../utils/env-file"
import { resolveOpenCodeConfiguration } from "./config"
import { resolveOpenCodeEnvironment } from "./credentials"

/** Runs OpenCode with selected environment variables and read-only provider staging mounts. */
export async function runOpenCodeContainer(options: Parameters<ProviderRunner>[0]): Promise<number> {
  const dotEnv = await loadDotEnv(options.workDir)
  const environment = { ...process.env, ...dotEnv }
  for(const name of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"]) environment[name] = process.env[name]
  const configuration = await resolveOpenCodeConfiguration(options.workDir, environment)
  const extraEnv = await resolveOpenCodeEnvironment(configuration, dotEnv)
  return spawnContainer({
    ...options,
    extraEnv,
    extraMounts: configuration.mounts
  })
}
