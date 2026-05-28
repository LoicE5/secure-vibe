import type { Runtime } from "./runtime"
import type { GitIdentity } from "./git"

/** Identifier of a CLI provider. Only "claude" has a runner today; the rest are reserved. */
export type ProviderId = "claude" | "codex" | "mistral" | "ccr"

/** Static metadata describing a provider — fed to the generic container/image helpers. */
export interface ProviderSpec {
  id: ProviderId
  imageName: string
  dockerfilePath: string
  brewVolumeName: string
  imageCheckCachePath: string
}

/** Uniform signature every provider runner exposes so the orchestrator stays provider-agnostic. */
export type ProviderRunner = (options: {
  runtime: Runtime
  workDir: string
  command: string | null
  gitConfig: GitIdentity | null
}) => Promise<number>
