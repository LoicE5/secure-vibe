import type { ParsedArgs, ProviderId } from "../types"

/** Maps each provider-selection flag (and its aliases) to a ProviderId. */
const PROVIDER_FLAGS: Record<string, ProviderId> = {
  "--claude": "claude",
  "--codex": "codex",
  "--chatgpt": "codex",
  "--gpt": "codex",
  "--mistral": "mistral",
  "--ccr": "ccr"
}

/**
 * Parses process.argv into a ParsedArgs object. Unknown flags are silently ignored.
 * The first positional becomes `directory`; remaining positionals join into `command`
 * (unless --command was passed explicitly).
 */
export function parseArgs(): ParsedArgs {
  const argv = process.argv.slice(2)
  const positionals: string[] = []
  let save: string | null = null
  let runtime: string | null = null
  let command: string | null = null
  let exclude: string | null = null
  let build = false
  let buildNoCache = false
  let pull = false
  let provider: ProviderId | null = null

  const consumed = new Set<number>()
  for(const [index, arg] of argv.entries()) {
    if(consumed.has(index)) continue
    if(arg === "--build-no-cache") {
      buildNoCache = true
    } else if(arg === "--build") {
      build = true
    } else if(arg === "--pull") {
      pull = true
    } else if(PROVIDER_FLAGS[arg]) {
      provider = PROVIDER_FLAGS[arg]!
    } else if(arg.startsWith("--runtime=")) {
      runtime = arg.slice("--runtime=".length)
    } else if(arg === "--runtime" && index + 1 < argv.length) {
      runtime = argv.at(index + 1)!
      consumed.add(index + 1)
    } else if(arg.startsWith("--save=")) {
      save = arg.slice("--save=".length)
    } else if(arg === "--save" && index + 1 < argv.length) {
      save = argv.at(index + 1)!
      consumed.add(index + 1)
    } else if(arg.startsWith("--command=")) {
      command = arg.slice("--command=".length)
    } else if(arg === "--command" && index + 1 < argv.length) {
      command = argv.at(index + 1)!
      consumed.add(index + 1)
    } else if(arg.startsWith("--exclude=")) {
      exclude = arg.slice("--exclude=".length)
    } else if(arg === "--exclude" && index + 1 < argv.length) {
      exclude = argv.at(index + 1)!
      consumed.add(index + 1)
    } else if(!arg.startsWith("-")) {
      positionals.push(arg)
    }
    // Unknown flags are ignored
  }

  return {
    directory: positionals.at(0) ?? null,
    save,
    runtime,
    command: command ?? (positionals.slice(1).join(" ") || null),
    exclude,
    build,
    buildNoCache,
    pull,
    provider
  }
}

/** Returns the env var value, or null if unset or set to "prompt". */
export function getEnvConfig(key: string): string | null {
  const value = process.env[key]
  if(!value || value.toLowerCase() === "prompt") return null
  return value
}

/** Returns true if the env var is "true", "1", or "yes" (case-insensitive). */
export function getBoolEnv(key: string): boolean {
  return ["true", "1", "yes"].includes(process.env[key]?.toLowerCase() ?? "")
}
