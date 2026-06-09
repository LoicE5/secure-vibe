import type { ProviderId } from "./provider"

/** Shape of the parsed CLI arguments, before env-var fallbacks are applied. */
export interface ParsedArgs {
  directory: string | null
  save: string | null
  runtime: string | null
  command: string | null
  exclude: string | null
  build: boolean
  buildNoCache: boolean
  pull: boolean
  local: boolean
  provider: ProviderId | null
}
