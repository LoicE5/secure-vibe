import { access, readFile } from "fs/promises"
import type { Runtime, GitIdentity } from "../../types"
import { CCR_CONFIG_DIR, CCR_CONFIG_PATH } from "../../constants"
import { spawnContainer } from "../../utils/container"
import type { ExtraMount } from "../../utils/container"
import { loadDotEnv, extractVarTokens } from "../../utils/env-file"
import { resolveCcrAnthropicCredentials } from "./credentials"
import { CCR_PROVIDER_SPEC } from "./spec"

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
 * never blanket-forwarded. The host config dir is mounted read-only (the entrypoint
 * mirrors it writable, or scaffolds a starter if absent). With `local`, a single
 * --add-host flag lets the container reach host-machine models (e.g. Ollama) — no
 * published ports, no host-network mode. CCR's local server stays on 127.0.0.1.
 */
export async function runCcrContainer(options: RunCcrContainerOptions): Promise<number> {
  const dotEnv = await loadDotEnv(process.cwd())

  // Discover which env vars the active config references (empty if no config yet).
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

  // Optionally reuse host Anthropic creds so a route back to Anthropic starts logged in.
  // Never required: CCR may route entirely off-Anthropic.
  const creds = await resolveCcrAnthropicCredentials()
  if(creds) extraEnv.CLAUDE_CREDENTIALS = creds

  const extraArgs: string[] = []
  if(options.local) {
    extraArgs.push("--add-host=host.docker.internal:host-gateway")
    console.info("  --local: adding host-gateway DNS entry (reach host models via http://host.docker.internal:<port>).")
  }

  // Mount the host config dir read-only (skipped if missing — `-v` would otherwise
  // create an empty root-owned dir). The entrypoint mirrors it writable / scaffolds.
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
