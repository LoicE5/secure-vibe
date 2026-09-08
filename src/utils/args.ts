import type { ParsedArgs, ProviderId } from "../types"
import type { BooleanFlag, ValueFlag } from "../constants"
import { FLAGS, PROVIDER_FLAGS } from "../constants"

export const PROVIDER_IDS = ["claude", "antigravity", "ccr", "codex", "vibe"] as const satisfies readonly ProviderId[]

type SecureVibeEnvKey = "DIRECTORY" | "RUNTIME" | "SAVE" | "COMMAND" | "EXCLUDE" | "BUILD" | "BUILD_NO_CACHE" | "PULL" | "LOCAL" | "DIND" | "PROVIDER"

export interface ResolvedConfiguration {
  directory: string | null
  save: string | null
  runtime: string | null
  command: string | null
  exclude: string | null
  build: boolean
  buildNoCache: boolean
  pull: boolean
  local: boolean
  dind: boolean
  provider: ProviderId
}

/** Type guard for provider values accepted through configuration. */
function isProviderId(value: string): value is ProviderId {
  return PROVIDER_IDS.some(providerId => providerId === value)
}

/** Parses process.argv per the FLAGS spec: first positional is `directory`, the rest `command`. */
export function parseArgs(): ParsedArgs {
  const argv = process.argv.slice(2)
  const positionals: string[] = []
  const values: Record<ValueFlag["key"], string | null> = { save: null, runtime: null, command: null, exclude: null }
  const booleans = { build: false, buildNoCache: false, pull: false, local: false, dind: false }
  let provider: ProviderId | null = null

  const consumed = new Set<number>()
  for(const [index, argument] of argv.entries()) {
    if(consumed.has(index)) continue

    const booleanFlag = FLAGS.find((flag): flag is BooleanFlag => flag.kind === "boolean" && flag.name === argument)
    if(booleanFlag) {
      booleans[booleanFlag.key] = true
      continue
    }

    if(PROVIDER_FLAGS[argument]) {
      provider = PROVIDER_FLAGS[argument]!
      continue
    }

    // Match a value flag in either `--flag=value` or `--flag value` form.
    const valueFlag = FLAGS.find(
      (flag): flag is ValueFlag => flag.kind === "value" && (argument === flag.name || argument.startsWith(`${flag.name}=`))
    )
    if(valueFlag) {
      if(argument.startsWith(`${valueFlag.name}=`)) {
        values[valueFlag.key] = argument.slice(valueFlag.name.length + 1)
      } else if(index + 1 < argv.length) {
        values[valueFlag.key] = argv.at(index + 1)!
        consumed.add(index + 1)
      }
      continue
    }

    if(!argument.startsWith("-")) positionals.push(argument)
  }

  return {
    directory: positionals.at(0) ?? null,
    save: values.save,
    runtime: values.runtime,
    command: values.command ?? (positionals.slice(1).join(" ") || null),
    exclude: values.exclude,
    build: booleans.build,
    buildNoCache: booleans.buildNoCache,
    pull: booleans.pull,
    local: booleans.local,
    dind: booleans.dind,
    provider
  }
}

/** Returns a prefixed env value, or null if unset or set to "prompt". */
export function getEnvConfig(key: SecureVibeEnvKey, environment: NodeJS.ProcessEnv = process.env): string | null {
  const value = environment[`SECURE_VIBE_${key}`]
  if(!value || value.toLowerCase() === "prompt") return null
  return value
}

/** Returns true if a prefixed env var is "true", "1", or "yes". */
export function getBoolEnv(key: SecureVibeEnvKey, environment: NodeJS.ProcessEnv = process.env): boolean {
  return ["true", "1", "yes"].includes(environment[`SECURE_VIBE_${key}`]?.toLowerCase() ?? "")
}

/** Resolves and validates the provider from CLI, environment, then the default. */
export function resolveProviderId(explicitProvider: ProviderId | null, environment: NodeJS.ProcessEnv = process.env): ProviderId {
  if(explicitProvider) return explicitProvider

  const configuredProvider = getEnvConfig("PROVIDER", environment) ?? "claude"
  if(isProviderId(configuredProvider)) return configuredProvider

  throw new Error(`Invalid SECURE_VIBE_PROVIDER value "${configuredProvider}". Expected: ${PROVIDER_IDS.join(", ")}.`)
}

/** Resolves CLI options over prefixed environment configuration. */
export function resolveConfiguration(args: ParsedArgs, environment: NodeJS.ProcessEnv = process.env): ResolvedConfiguration {
  return {
    directory: args.directory ?? getEnvConfig("DIRECTORY", environment),
    save: args.save ?? getEnvConfig("SAVE", environment),
    runtime: args.runtime ?? getEnvConfig("RUNTIME", environment),
    command: args.command ?? getEnvConfig("COMMAND", environment),
    exclude: args.exclude ?? getEnvConfig("EXCLUDE", environment),
    build: args.build || getBoolEnv("BUILD", environment),
    buildNoCache: args.buildNoCache || getBoolEnv("BUILD_NO_CACHE", environment),
    pull: args.pull || getBoolEnv("PULL", environment),
    local: args.local || getBoolEnv("LOCAL", environment),
    dind: args.dind || getBoolEnv("DIND", environment),
    provider: resolveProviderId(args.provider, environment)
  }
}
