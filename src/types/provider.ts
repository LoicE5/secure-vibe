import type { Runtime } from "./runtime"
import type { GitIdentity } from "./git"

/** Identifier of a CLI provider. "claude", "antigravity", and "ccr" have runners today. */
export type ProviderId = "claude" | "antigravity" | "ccr"
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
  /** Opt-in host-machine access (ccr `--local`); claude/agy ignore it. */
  local?: boolean
}) => Promise<number>
