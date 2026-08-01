import { access, readFile, mkdir, writeFile } from "fs/promises"
import type { Runtime, GitIdentity, ProviderSpec } from "../../types"
import { CCR_CONFIG_DIR, CCR_CONFIG_PATH, CCR_CONFIG_SQLITE_PATH } from "../../constants"
import { spawnContainer } from "../../utils/container"
import type { ExtraMount } from "../../utils/container"
import { loadDotEnv, extractVarTokens } from "../../utils/env-file"
// Bun inlines this at build time, so the bundled CLI has no runtime dependency on the asset.
import STARTER_CONFIG from "../../assets/ccr-starter-config.json"

/** Writes the starter config to the host when none exists, so it persists and is editable. */
async function ensureHostConfig(): Promise<boolean> {
  const exists = await access(CCR_CONFIG_PATH).then(() => true).catch(() => false)
  if(exists) return false
  await mkdir(CCR_CONFIG_DIR, { recursive: true })
  await writeFile(CCR_CONFIG_PATH, JSON.stringify(STARTER_CONFIG, null, 2), { mode: 0o600 })
  return true
}

/** Warns when a config still uses the CCR 2.x schema; the host file is never modified. */
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

/** Drops `_`-prefixed keys so prose in a `_comment` can't register as a `$VAR` reference. */
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
  spec: ProviderSpec
  workDir: string
  command: string | null
  gitConfig: GitIdentity | null
  /** Opt-in host-machine access: adds --add-host=host.docker.internal:host-gateway. */
  local?: boolean
}

/** Runs the CCR container, forwarding only the env vars its config references (.env wins). */
export async function runCcrContainer(options: RunCcrContainerOptions): Promise<number> {
  const dotEnv = await loadDotEnv(process.cwd())

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

  // Interpolation happens on CCR's legacy-JSON import path alone, hence the sqlite-free start.
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

  const extraArgs: string[] = []
  if(options.local) {
    extraArgs.push("--add-host=host.docker.internal:host-gateway")
    console.info("  --local: adding host-gateway DNS entry (reach host models via http://host.docker.internal:<port>).")
  }

  const extraMounts: ExtraMount[] = []
  const configDirExists = await access(CCR_CONFIG_DIR).then(() => true).catch(() => false)
  if(configDirExists) extraMounts.push([CCR_CONFIG_DIR, "/home/viber/.claude-code-router-host", "ro"])

  return spawnContainer({
    runtime: options.runtime,
    spec: options.spec,
    workDir: options.workDir,
    gitConfig: options.gitConfig,
    command: options.command,
    extraEnv,
    extraMounts,
    extraArgs
  })
}
