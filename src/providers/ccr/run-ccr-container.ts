import { access, readFile, mkdir, writeFile } from "fs/promises"
import type { Runtime, GitIdentity } from "../../types"
import { CCR_CONFIG_DIR, CCR_CONFIG_PATH } from "../../constants"
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
    console.info(`  No CCR config found — wrote a starter to ${CCR_CONFIG_PATH}.`)
    console.info("    It defaults to a free OpenRouter model — set OPENROUTER_API_KEY in your project .env, then re-run.")
  }

  // Discover which env vars the active config references (empty if unreadable).
  const configRaw = await readFile(CCR_CONFIG_PATH, "utf-8").catch(() => "")
  const referenced = extractVarTokens(configRaw)

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
