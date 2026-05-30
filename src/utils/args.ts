import type { ParsedArgs, ProviderId } from "../types"
import type { ValueFlag } from "../constants"
import { FLAGS, PROVIDER_FLAGS } from "../constants"

/**
 * Parses process.argv into a ParsedArgs object. Unknown flags are silently ignored.
 * The first positional becomes `directory`; remaining positionals join into `command`
 * (unless --command was passed explicitly).
 *
 * Boolean/value flags are driven by the shared FLAGS spec (src/constants/flags.ts),
 * the same source the dynamic completion handler reads — so the two never drift.
 */
export function parseArgs(): ParsedArgs {
  const argv = process.argv.slice(2)
  const positionals: string[] = []
  const values: Record<ValueFlag["key"], string | null> = { save: null, runtime: null, command: null, exclude: null }
  const booleans = { build: false, buildNoCache: false, pull: false }
  let provider: ProviderId | null = null

  const consumed = new Set<number>()
  for(const [index, arg] of argv.entries()) {
    if(consumed.has(index)) continue

    const boolFlag = FLAGS.find(f => f.kind === "boolean" && f.name === arg)
    if(boolFlag) {
      booleans[boolFlag.key as keyof typeof booleans] = true
      continue
    }

    if(PROVIDER_FLAGS[arg]) {
      provider = PROVIDER_FLAGS[arg]!
      continue
    }

    // Match a value flag in either `--flag=value` or `--flag value` form.
    const valueFlag = FLAGS.find(
      (f): f is ValueFlag => f.kind === "value" && (arg === f.name || arg.startsWith(`${f.name}=`))
    )
    if(valueFlag) {
      if(arg.startsWith(`${valueFlag.name}=`)) {
        values[valueFlag.key] = arg.slice(valueFlag.name.length + 1)
      } else if(index + 1 < argv.length) {
        values[valueFlag.key] = argv.at(index + 1)!
        consumed.add(index + 1)
      }
      continue
    }

    if(!arg.startsWith("-")) positionals.push(arg)
    // Unknown flags are ignored
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
