/**
 * CCR (claude-code-router) container entrypoint (PID 1).
 *
 * Runs every time the CCR provider container starts. Responsibilities:
 *   1. Seed the named brew volume from /opt/linuxbrew-seed on first run.
 *   2. Mirror the read-only ~/.claude-code-router-host mount into a writable
 *      ~/.claude-code-router, skipping CCR's own sqlite state (see below).
 *   3. Normalize that config: pin HOST to loopback, inject a dummy APIKEY when none is
 *      set, and read Router.default/background — which CCR 3.x ignores — to derive the
 *      ANTHROPIC_* model env Claude Code actually honours.
 *   4. Start `ccr serve` as a sidecar gateway and wait for it to answer /health.
 *   5. Pre-accept Claude Code's first-run flags (onboarding, trust, bypass) in
 *      ~/.claude.json so it launches straight into a session with no wizard — done
 *      unconditionally since CCR users usually have no Anthropic account. No OAuth is
 *      injected (it could make Claude bypass CCR and hit Anthropic directly).
 *   6. Apply host git identity from $GIT_USER_NAME / $GIT_USER_EMAIL.
 *   7. Ignore SIGINT at PID 1 so Ctrl+C kills only the foreground job without exiting the
 *      shell; tear the gateway down on SIGTERM and on normal exit.
 *   8. Spawn either the explicit command (and set $SECURE_VIBE_EXPLICIT_CMD=1 so the
 *      bashrc auto-start guard skips ccr) or an interactive bash.
 *
 * CCR 3.x dropped `ccr code`, so CCR no longer launches Claude Code — it is a plain
 * Anthropic-compatible gateway on 127.0.0.1 and the /home/viber/bin/claude wrapper points
 * at it. That wrapper is the single source for the bypass flag and the sandbox prompt.
 *
 * CRITICAL INVARIANT: CCR imports config.json ONLY when its sqlite store has no config row,
 * then deletes the JSON. Three things depend on the container starting with no sqlite —
 * the mounted config being read at all, `$VAR` interpolation (legacy-import path only, which
 * is what makes the runner's least-privilege env forwarding work), and host edits taking
 * effect on the next run. Hence the mirror exclusions and the purge below.
 *
 * The COPY directive in docker/ccr.dockerfile maps this file to the provider-agnostic
 * in-container path /home/viber/entrypoint.ts.
 */

import { mkdir, writeFile, readFile, access } from "fs/promises"
import { openSync } from "fs"
import { $ } from "bun"

// ── Seed linuxbrew volume on first run ────────────────────────────────────────
// The named volume at /home/linuxbrew starts empty; copy from the seed baked
// into the image. Subsequent runs skip this entirely.
const brewReady = await access("/home/linuxbrew/.linuxbrew").then(() => true).catch(() => false)
if(!brewReady) {
  console.info("  [entrypoint] First run: seeding brew volume from image (this may take a minute)…")
  await $`cp -a /opt/linuxbrew-seed/. /home/linuxbrew/`.nothrow()
  console.info("  [entrypoint] Brew volume ready.")
} else {
  // The brew volume persists and stores real numeric UID ownership. If it was
  // seeded by an image with a different UID (e.g. an older build), brew can't
  // write it and there's no root at runtime to repair it. Detect that early and
  // tell the user exactly how to recover instead of letting brew fail cryptically.
  const { exitCode } = await $`test -w /home/linuxbrew/.linuxbrew/Cellar`.nothrow().quiet()
  if(exitCode !== 0) {
    console.warn("  [entrypoint] ⚠ The brew volume is owned by a different UID — brew will fail to install packages.")
    console.warn("  [entrypoint]   Reset it once from the host with: docker volume rm secure-vibe-brew")
  }
}

const HOME_DIR = "/home/viber"
const CCR_DIR = `${HOME_DIR}/.claude-code-router`
const CCR_HOST_DIR = `${HOME_DIR}/.claude-code-router-host`
const CCR_CONFIG_PATH = `${CCR_DIR}/config.json`
// Image-baked starter (src/assets/ccr-starter-config.json, COPYed in by the Dockerfile). Same
// single source the host runner imports, so the host and fallback scaffolds never drift.
const CCR_STARTER_CONFIG_PATH = `${HOME_DIR}/.ccr-starter-config.json`
const CCR_ENV_PATH = `${HOME_DIR}/.secure-vibe-ccr.env`
const CCR_LOG_PATH = `${HOME_DIR}/.ccr-serve.log`
const CCR_BIN = `${HOME_DIR}/bin/ccr-default`
const DEFAULT_PORT = 3456
const DEFAULT_APIKEY = "secure-vibe"

// CCR's own state, never mirrored from the host: sqlite would suppress the config.json
// import (see CRITICAL INVARIANT above) and service.json describes a service that isn't
// running in this container.
const CCR_STATE_ENTRIES = [
  "config.sqlite",
  "config.sqlite-wal",
  "config.sqlite-shm",
  "app-data",
  "service.json",
  "claude-app-gateway-backup.json"
]

/** Copies a read-only host mount into a writable copy, skipping CCR's own runtime state. */
async function mirror(hostDir: string, targetDir: string): Promise<void> {
  const hostExists = await access(hostDir).then(() => true).catch(() => false)
  if(!hostExists) return
  await mkdir(targetDir, { recursive: true })
  const excludes = CCR_STATE_ENTRIES.map(entry => `! -name ${entry}`).join(" ")
  const cpProc = Bun.spawn(
    ["bash", "-c", `find "${hostDir}" -mindepth 1 -maxdepth 1 ${excludes} -exec cp -rp -t "${targetDir}" {} + 2>/dev/null; chmod -R u+w "${targetDir}" 2>/dev/null; true`],
    { stdout: "pipe", stderr: "pipe" }
  )
  await cpProc.exited
}

await mkdir(CCR_DIR, { recursive: true })
await mirror(CCR_HOST_DIR, CCR_DIR)

// Belt and braces: guarantee the JSON import path runs even if the mirror leaked state or a
// previous layer left something behind. Cheap, and the whole design rests on it.
await $`rm -rf ${CCR_DIR}/config.sqlite ${CCR_DIR}/config.sqlite-wal ${CCR_DIR}/config.sqlite-shm ${CCR_DIR}/app-data`.nothrow().quiet()

/** What the container needs from the CCR config once CCR has consumed (and deleted) it. */
interface CcrConfigSummary {
  port: number
  apiKey: string
  defaultModel: string | null
  backgroundModel: string | null
}

/**
 * Converts a v2 `provider,model` selector to the 3.x `Provider/model` form, leaving
 * already-migrated values untouched.
 */
function toModelSelector(value: unknown): string | null {
  if(typeof value !== "string" || value.length === 0) return null
  const separator = value.indexOf(",")
  if(separator === -1) return value
  return `${value.slice(0, separator)}/${value.slice(separator + 1)}`
}

/** Every `Provider/model` selector the config actually serves. */
function providerModelSelectors(config: Record<string, unknown>): string[] {
  const providers = Array.isArray(config.Providers) ? config.Providers : []
  const selectors: string[] = []
  for(const entry of providers) {
    if(typeof entry !== "object" || entry === null) continue
    const provider = entry as Record<string, unknown>
    if(typeof provider.name !== "string") continue
    const models = Array.isArray(provider.models) ? provider.models : []
    for(const model of models) {
      if(typeof model === "string") selectors.push(`${provider.name}/${model}`)
    }
  }
  return selectors
}

/**
 * Normalizes the mirrored config in place and returns what the rest of the entrypoint needs.
 * Must be called before `ccr serve`, which deletes config.json after importing it.
 */
async function normalizeCcrConfig(): Promise<CcrConfigSummary> {
  const fallback: CcrConfigSummary = { port: DEFAULT_PORT, apiKey: DEFAULT_APIKEY, defaultModel: null, backgroundModel: null }

  let raw: string
  try {
    raw = await readFile(CCR_CONFIG_PATH, "utf-8")
  } catch(readError: unknown) {
    // No config mounted — scaffold the image-baked starter into an EPHEMERAL in-container
    // copy (lost on exit). The host runner normally scaffolds a persistent config before
    // spawn, so reaching here is the fallback path.
    try {
      raw = await readFile(CCR_STARTER_CONFIG_PATH, "utf-8")
      await writeFile(CCR_CONFIG_PATH, raw, { mode: 0o600 })
      console.warn("  [entrypoint] ⚠ No CCR config was mounted — using an ephemeral in-container starter (lost on exit).")
      console.warn("  [entrypoint]   Create ~/.claude-code-router/config.json on the HOST (or re-run from the host) to persist it.")
    } catch(starterError: unknown) {
      console.warn("  [entrypoint] ⚠ No CCR config was mounted and the bundled starter could not be read:", starterError)
      console.warn("  [entrypoint]   Original error:", readError)
      return fallback
    }
  }

  let config: Record<string, unknown>
  try {
    config = JSON.parse(raw)
  } catch(parseError: unknown) {
    console.warn("  [entrypoint] ⚠ ~/.claude-code-router/config.json was not valid JSON; leaving it as-is:", parseError)
    return fallback
  }

  // Pin HOST to loopback unconditionally. The container publishes no ports so this can't be
  // reached from the host regardless, but it keeps the "never bind wide" guarantee.
  config.HOST = "127.0.0.1"
  // CCR 3.x rejects every gateway request without a key, and Claude Code needs a non-empty
  // token to consider itself authenticated. Only inject when absent, so a real key is kept.
  const apiKey = typeof config.APIKEY === "string" && config.APIKEY.length > 0 ? config.APIKEY : DEFAULT_APIKEY
  config.APIKEY = apiKey

  // `ccr serve` otherwise takes over ~/.claude/settings.json for its Agent Profiles, writing an
  // apiKeyHelper that fights the ANTHROPIC_AUTH_TOKEN we set — Claude Code warns "auth may not
  // work as expected". We never launch profiles, so turn the whole mechanism off.
  const profile = typeof config.profile === "object" && config.profile !== null
    ? config.profile as Record<string, unknown>
    : {}
  profile.enabled = false
  config.profile = profile

  const router = typeof config.Router === "object" && config.Router !== null
    ? config.Router as Record<string, unknown>
    : {}
  const defaultModel = toModelSelector(router.default)
  const backgroundModel = toModelSelector(router.background) ?? defaultModel

  // A Router slot naming a model no provider lists is only caught by CCR at request time, as an
  // opaque 400 mid-session. Say so up front instead.
  const available = providerModelSelectors(config)
  const unserved = [...new Set([defaultModel, backgroundModel].filter(
    (selector): selector is string => selector !== null && available.length > 0 && !available.includes(selector)
  ))]
  if(unserved.length > 0) {
    console.warn(`  [entrypoint] ⚠ No provider serves: ${unserved.join(", ")} — requests using it will fail with a 400.`)
    console.warn(`  [entrypoint]   Configured models: ${available.join(", ")}`)
    console.warn("  [entrypoint]   Fix Router.default/background in the host config, or switch in-session with /model.")
  }

  await writeFile(CCR_CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 })

  const port = typeof config.PORT === "number" ? config.PORT : DEFAULT_PORT
  return { port, apiKey, defaultModel, backgroundModel }
}

const ccrConfig = await normalizeCcrConfig()

// ── Gateway sidecar ───────────────────────────────────────────────────────────
// Output goes to a log file, never to the TTY: `ccr serve` prints a management-server
// banner (and per-request lines) that would corrupt Claude Code's TUI rendering.
const gatewayLogFd = openSync(CCR_LOG_PATH, "a")
const gateway = Bun.spawn([CCR_BIN, "serve", "--no-open"], {
  stdin: "ignore",
  stdout: gatewayLogFd,
  stderr: gatewayLogFd
})

type GatewayOutcome = "ready" | "exited" | "timeout"

/**
 * Polls the gateway's unauthenticated /health until it can actually route, the child dies, or
 * we time out. Probe failures are expected while it boots, so the last one is only reported if
 * we give up. Note /health answers 200 with {"status":"starting"} well before the core gateway
 * is up, so status is checked too — matching on "not starting" rather than a specific ready
 * value keeps this from hanging if CCR renames that state.
 */
let lastProbeError: unknown = null
async function waitForGateway(port: number, timeoutMs: number): Promise<GatewayOutcome> {
  const deadline = Date.now() + timeoutMs
  while(Date.now() < deadline) {
    if(gateway.exitCode !== null) return "exited"
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })
      if(response.ok) {
        const health = await response.json() as { status?: string }
        if(health.status !== "starting") return "ready"
      }
    } catch(probeError: unknown) {
      lastProbeError = probeError
    }
    await Bun.sleep(250)
  }
  return "timeout"
}

const gatewayOutcome = await waitForGateway(ccrConfig.port, 30_000)
if(gatewayOutcome === "ready") {
  const routed = ccrConfig.defaultModel ? ` (model: ${ccrConfig.defaultModel})` : ""
  console.info(`  [entrypoint] CCR gateway ready on 127.0.0.1:${ccrConfig.port}${routed}.`)
} else if(gatewayOutcome === "timeout" && gateway.exitCode === null) {
  console.warn(`  [entrypoint] ⚠ The CCR gateway is still starting after 30s — the first request may fail. See ${CCR_LOG_PATH}.`)
} else {
  // Non-fatal on purpose, matching the brew-volume failure above: drop the user into the
  // shell so they can read the log and fix their config instead of losing the container.
  const log = await readFile(CCR_LOG_PATH, "utf-8").catch(() => "")
  console.warn("  [entrypoint] ⚠ The CCR gateway did not start — Claude Code will not be able to reach a model.")
  if(log.includes("No available models")) {
    console.warn("  [entrypoint]   CCR 3.x refuses to start unless at least one provider lists at least one model.")
    console.warn("  [entrypoint]   Add a non-empty \"models\": [...] to a provider in ~/.claude-code-router/config.json on the host.")
  } else {
    if(gateway.exitCode !== null) console.warn(`  [entrypoint]   \`ccr serve\` exited with code ${gateway.exitCode}.`)
    else if(lastProbeError) console.warn("  [entrypoint]   Last health probe failed:", lastProbeError)
    console.warn(`  [entrypoint]   Last lines of ${CCR_LOG_PATH}:`)
    for(const line of log.trimEnd().split("\n").slice(-15)) console.warn(`  [entrypoint]   | ${line}`)
  }
}

// Endpoint + token for every shell in this container. The wrappers and .bashrc source this
// file, so `docker exec -it <container> claude` works even though it inherits nothing.
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

// BASE_URL/AUTH_TOKEN are hard-set — a stale value means talking to Anthropic directly, which
// would defeat the container. The model vars use := so `ANTHROPIC_MODEL=x claude` still wins.
const envFileLines = [
  `export ANTHROPIC_BASE_URL=${shellQuote(`http://127.0.0.1:${ccrConfig.port}`)}`,
  `export ANTHROPIC_AUTH_TOKEN=${shellQuote(ccrConfig.apiKey)}`
]
const modelDefaults: Record<string, string | null> = {
  ANTHROPIC_MODEL: ccrConfig.defaultModel,
  ANTHROPIC_DEFAULT_OPUS_MODEL: ccrConfig.defaultModel,
  ANTHROPIC_DEFAULT_SONNET_MODEL: ccrConfig.defaultModel,
  // Claude Code sends Haiku for titles, summaries and file suggestions; without a mapping
  // those calls ask the gateway for a model no provider serves and fail mid-session.
  ANTHROPIC_DEFAULT_HAIKU_MODEL: ccrConfig.backgroundModel
}
for(const [name, value] of Object.entries(modelDefaults)) {
  if(value) envFileLines.push(`: "\${${name}:=${value}}"; export ${name}`)
}
await writeFile(CCR_ENV_PATH, `${envFileLines.join("\n")}\n`, { mode: 0o600 })

const gatewayEnv: Record<string, string> = {
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${ccrConfig.port}`,
  ANTHROPIC_AUTH_TOKEN: ccrConfig.apiKey
}
for(const [name, value] of Object.entries(modelDefaults)) {
  if(value && !process.env[name]) gatewayEnv[name] = value
}

// Pre-accept Claude Code's first-run flags so it launches straight into a session
// instead of the onboarding wizard (theme picker, trust-folder, bypass warning).
// CCR users typically have NO Anthropic account — CCR supplies the endpoint and token —
// so we seed these UNCONDITIONALLY (the claude provider only does it alongside creds).
//
// We deliberately do NOT inject Claude.ai OAuth here: a real subscription token can make
// Claude Code talk to Anthropic directly and ignore CCR's local endpoint, defeating routing.
const CLAUDE_DIR = `${HOME_DIR}/.claude`
const CLAUDE_JSON = `${HOME_DIR}/.claude.json`
const CLAUDE_SETTINGS = `${CLAUDE_DIR}/settings.json`
await mkdir(CLAUDE_DIR, { recursive: true })

let claudeJson: Record<string, unknown> = {}
try {
  claudeJson = JSON.parse(await readFile(CLAUDE_JSON, "utf-8"))
} catch {
  claudeJson = {}
}

claudeJson.hasCompletedOnboarding = true
if(!claudeJson.theme) claudeJson.theme = "dark"

// Pre-approve the token CCR expects so Claude doesn't prompt "use this custom API key?".
if(!claudeJson.customApiKeyResponses) {
  claudeJson.customApiKeyResponses = { approved: [ccrConfig.apiKey], rejected: [] }
}

const APP_DIR = "/home/viber/app"
if(!claudeJson.projects) claudeJson.projects = {}
const projects = claudeJson.projects as Record<string, Record<string, unknown>>
if(!projects[APP_DIR]) projects[APP_DIR] = {}
projects[APP_DIR].hasTrustDialogAccepted = true

await writeFile(CLAUDE_JSON, JSON.stringify(claudeJson), { mode: 0o600 })

// Suppress the bypass-permissions warning dialog (modern Claude Code gates it on this
// settings key, not the legacy ~/.claude.json bypassPermissionsModeAccepted flag).
let claudeSettings: Record<string, unknown> = {}
try {
  claudeSettings = JSON.parse(await readFile(CLAUDE_SETTINGS, "utf-8"))
} catch {
  claudeSettings = {}
}
claudeSettings.skipDangerousModePermissionPrompt = true
// Defensive: if any CCR version still installs its profile apiKeyHelper, drop it — it and our
// ANTHROPIC_AUTH_TOKEN are mutually exclusive as far as Claude Code is concerned.
delete claudeSettings.apiKeyHelper
await writeFile(CLAUDE_SETTINGS, JSON.stringify(claudeSettings, null, 2), { mode: 0o600 })

// Apply host git identity so commits made inside the container are attributed correctly.
const gitUserName = process.env.GIT_USER_NAME
const gitUserEmail = process.env.GIT_USER_EMAIL
if(gitUserName) {
  await $`git config --global user.name ${gitUserName}`.quiet().nothrow()
}
if(gitUserEmail) {
  await $`git config --global user.email ${gitUserEmail}`.quiet().nothrow()
}

// Ignore SIGINT at the bun (PID 1) level so ctrl+c inside the container
// only reaches bash's job control, which kills the foreground job (claude)
// without terminating the shell itself. The gateway is not in bash's foreground
// process group, so it survives too.
process.on("SIGINT", () => {})
// `ccr serve` stops listening on SIGTERM but does not exit promptly, and it owns a core-gateway
// grandchild bun can't signal directly. Exiting PID 1 right after is what actually tears the
// container (and both processes) down; the signal is a courtesy so CCR can flush first.
process.on("SIGTERM", () => {
  gateway.kill()
  process.exit(143)
})

const cmd = process.argv.slice(2)
const isExplicitCmd = cmd.length > 0
const childEnv = isExplicitCmd
  ? { ...process.env, ...gatewayEnv, SECURE_VIBE_EXPLICIT_CMD: "1" }
  : { ...process.env, ...gatewayEnv }

const proc = Bun.spawn(isExplicitCmd ? cmd : ["bash", "-i"], {
  env: childEnv,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit"
})

const exitCode = await proc.exited
gateway.kill()
process.exit(exitCode)
