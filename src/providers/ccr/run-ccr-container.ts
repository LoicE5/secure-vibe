import { access, readFile, mkdir, writeFile } from "fs/promises"
import type { Runtime, GitIdentity } from "../../types"
import { CCR_CONFIG_DIR, CCR_CONFIG_PATH, CCR_CONFIG_SQLITE_PATH } from "../../constants"
import { spawnContainer } from "../../utils/container"
import type { ExtraMount } from "../../utils/container"
import { loadDotEnv, extractVarTokens } from "../../utils/env-file"
import { CCR_PROVIDER_SPEC } from "./spec"
// Single source of truth for the starter config (shared with the container entrypoint, which
// reads the same file copied into the image). Bun inlines this JSON at build time, so the
// bundled CLI has no runtime dependency on the asset path.
import STARTER_CONFIG from "../../assets/ccr-starter-config.json"

/**
 * Minimal starter config written to the HOST when none exists, so the user has a real,
 * persistent, editable file (the container mount is read-only). APIKEY is a dummy that CCR
 * forwards to Claude Code as its auth token so it skips the onboarding wizard. Defaults to a
 * free, tool-calling OpenRouter model (runs with just $OPENROUTER_API_KEY in the project .env,
 * no --local); a local MLX provider is included to switch to if you run one (needs --local).
 * The literal lives in src/assets/ccr-starter-config.json — edit it there.
 */

/**
 * Ensures a CCR config exists ON THE HOST. If ~/.claude-code-router/config.json is
 * absent, writes the starter there (never overwrites an existing file) so it persists
 * and the user can edit it — then it gets mounted read-only and mirrored into the
 * container like any real config. Returns true if it scaffolded.
 */
async function ensureHostConfig(): Promise<boolean> {
  const exists = await access(CCR_CONFIG_PATH).then(() => true).catch(() => false)
  if(exists) return false
  await mkdir(CCR_CONFIG_DIR, { recursive: true })
  await writeFile(CCR_CONFIG_PATH, JSON.stringify(STARTER_CONFIG, null, 2), { mode: 0o600 })
  return true
}

/**
 * Warns when a config still uses the CCR 2.x schema. The container translates it on the fly;
 * this only tells the user what changed. The host file is never modified.
 */
function warnOnLegacyConfig(raw: string): void {
  let config: Record<string, unknown>
  try {
    config = JSON.parse(raw)
  } catch(parseError: unknown) {
    console.warn("  ⚠ ~/.claude-code-router/config.json is not valid JSON — CCR will fall back to its defaults.", parseError)
    return
  }

  const router = typeof config.Router === "object" && config.Router !== null
    ? config.Router as Record<string, unknown>
    : {}
  // Already migrated: 3.x expresses routing as rules/fallback. Leave it alone.
  if("rules" in router || "fallback" in router) return

  const providers = Array.isArray(config.Providers) ? config.Providers : []
  const droppedSlots = ["think", "longContext", "webSearch"].filter(slot => slot in router)
  const usesCommaSelector = Object.values(router).some(value => typeof value === "string" && value.includes(","))
  const usesTransformer = providers.some(provider => typeof provider === "object" && provider !== null && "transformer" in provider)
  if(droppedSlots.length === 0 && !usesCommaSelector && !usesTransformer) return

  console.warn("  ⚠ Your ~/.claude-code-router/config.json uses the CCR 2.x schema.")
  console.warn("    CCR 3.x dropped Router.default/background/think/longContext/webSearch and switched")
  console.warn("    model selectors from \"provider,model\" to \"Provider/model\".")
  console.warn("    secure-vibe maps Router.default/background onto Claude Code's ANTHROPIC_MODEL /")
  console.warn("    ANTHROPIC_DEFAULT_HAIKU_MODEL inside the container; your host file is never modified.")
  if(droppedSlots.length > 0) {
    console.warn(`    No 3.x equivalent, ignored: ${droppedSlots.join(", ")}.`)
  }
  if(usesTransformer) {
    console.warn("    Providers[].transformer is vestigial in 3.x (protocol is sniffed instead).")
  }
}

/**
 * Drops `_`-prefixed keys before the config is scanned for `$VAR` references, so prose in a
 * `_comment` (the scaffolded starter documents `$VAR` forwarding) can't register as a variable.
 */
function stripCommentKeys(raw: string): string {
  try {
    const config: Record<string, unknown> = JSON.parse(raw)
    for(const key of Object.keys(config)) {
      if(key.startsWith("_")) delete config[key]
    }
    return JSON.stringify(config)
  } catch {
    return raw
  }
}

/** Options the orchestrator passes to runCcrContainer. */
export interface RunCcrContainerOptions {
  runtime: Runtime
  workDir: string
  command: string | null
  gitConfig: GitIdentity | null
  /** Opt-in host-machine access: adds --add-host=host.docker.internal:host-gateway. */
  local?: boolean
}

/**
 * Runs the CCR (claude-code-router) container.
 *
 * Env forwarding is strict least-privilege: we parse the host's config.json for
 * `$VAR`/`${VAR}` tokens and forward ONLY those, each resolved from the project .env
 * first then the host env (.env wins). Nothing referenced → nothing forwarded; .env is
 * never blanket-forwarded. When no host config exists we scaffold a starter ON THE HOST
 * (so it persists and is editable), then mount the dir read-only; the entrypoint mirrors
 * it into a writable copy. With `local`, a single --add-host flag lets the container reach
 * host-machine models (e.g. Ollama) — no published ports, no host-network mode. CCR's
 * local server stays on 127.0.0.1.
 */
export async function runCcrContainer(options: RunCcrContainerOptions): Promise<number> {
  const dotEnv = await loadDotEnv(process.cwd())

  // Give the user a real, editable config on the host if they have none yet.
  if(await ensureHostConfig()) {
    const consumedByCcr = await access(CCR_CONFIG_SQLITE_PATH).then(() => true).catch(() => false)
    if(consumedByCcr) {
      console.warn(`  ⚠ No config.json found, but ${CCR_CONFIG_SQLITE_PATH} exists.`)
      console.warn("    CCR 3.x running on this host imported your config into sqlite and deleted the JSON.")
      console.warn("    secure-vibe reads config.json only, so a starter was scaffolded — copy your providers")
      console.warn("    back into it (CCR's own UI can show the imported config).")
    } else {
      console.info(`  No CCR config found — wrote a starter to ${CCR_CONFIG_PATH}.`)
      console.info("    It defaults to a free OpenRouter model — set OPENROUTER_API_KEY in your project .env, then re-run.")
    }
  }

  // Discover which env vars the active config references (empty if unreadable). This only works
  // because the container always starts with no CCR sqlite store: interpolation happens on
  // CCR's legacy-JSON import path alone. Persisting that store would silently break it.
  const configRaw = await readFile(CCR_CONFIG_PATH, "utf-8").catch(() => "")
  if(configRaw) warnOnLegacyConfig(configRaw)
  const referenced = extractVarTokens(stripCommentKeys(configRaw))

  const extraEnv: Record<string, string> = {}
  const missing: string[] = []
  for(const name of referenced) {
    const value = dotEnv[name] ?? process.env[name]
    if(value !== undefined) {
      extraEnv[name] = value
    } else {
      missing.push(name)
    }
  }
  if(referenced.length > 0) {
    const forwarded = referenced.filter(name => name in extraEnv)
    console.info(`  CCR config references ${referenced.length} env var(s); forwarding ${forwarded.length} (.env wins over host env).`)
  }
  if(missing.length > 0) {
    console.warn(`  ⚠ Unresolved CCR config var(s): ${missing.join(", ")}. CCR will substitute empty values — set them in .env or your shell.`)
  }

  // Note: we do NOT inject Anthropic credentials. CCR talks to its providers using the
  // keys in its own config; Claude Code only needs CCR's local endpoint + dummy token.
  // A real Claude.ai subscription token here could make Claude bypass CCR entirely.

  const extraArgs: string[] = []
  if(options.local) {
    extraArgs.push("--add-host=host.docker.internal:host-gateway")
    console.info("  --local: adding host-gateway DNS entry (reach host models via http://host.docker.internal:<port>).")
  }

  // Mount the host config dir read-only (always present — ensureHostConfig created it
  // if absent). The entrypoint mirrors it into a writable copy inside the container.
  const extraMounts: ExtraMount[] = []
  const configDirExists = await access(CCR_CONFIG_DIR).then(() => true).catch(() => false)
  if(configDirExists) extraMounts.push([CCR_CONFIG_DIR, "/home/viber/.claude-code-router-host", "ro"])

  return spawnContainer({
    runtime: options.runtime,
    spec: CCR_PROVIDER_SPEC,
    workDir: options.workDir,
    gitConfig: options.gitConfig,
    command: options.command,
    extraEnv,
    extraMounts,
    extraArgs
  })
}
