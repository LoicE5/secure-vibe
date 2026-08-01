import { mkdir, writeFile, readFile, access } from "fs/promises"
import { openSync } from "fs"
import { $ } from "bun"

const brewReady = await access("/home/linuxbrew/.linuxbrew").then(() => true).catch(() => false)
if(!brewReady) {
  console.info("  [entrypoint] First run: seeding brew volume from image (this may take a minute)…")
  await $`cp -a /opt/linuxbrew-seed/. /home/linuxbrew/`.nothrow()
  console.info("  [entrypoint] Brew volume ready.")
} else {
  // The volume stores numeric UID ownership and there is no root at runtime to repair it.
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
const CCR_STARTER_CONFIG_PATH = `${HOME_DIR}/.ccr-starter-config.json`
const CCR_ENV_PATH = `${HOME_DIR}/.secure-vibe-ccr.env`
const CCR_LOG_PATH = `${HOME_DIR}/.ccr-serve.log`
const CCR_BIN = `${HOME_DIR}/bin/ccr-default`
const DEFAULT_PORT = 3456
const DEFAULT_APIKEY = "secure-vibe"

// CCR's own state, never mirrored: it would suppress the config.json import (see below).
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

// CCR imports config.json only when its sqlite store is empty, so the mounted config, `$VAR`
// interpolation and host edits all depend on the container starting without one.
await $`rm -rf ${CCR_DIR}/config.sqlite ${CCR_DIR}/config.sqlite-wal ${CCR_DIR}/config.sqlite-shm ${CCR_DIR}/app-data`.nothrow().quiet()

/** What the container needs from the CCR config once CCR has consumed (and deleted) it. */
interface CcrConfigSummary {
  port: number
  apiKey: string
  defaultModel: string | null
  backgroundModel: string | null
}

/** Converts a v2 `provider,model` selector to the 3.x `Provider/model` form. */
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

/** Normalizes the mirrored config in place; must run before `ccr serve` deletes it. */
async function normalizeCcrConfig(): Promise<CcrConfigSummary> {
  const fallback: CcrConfigSummary = { port: DEFAULT_PORT, apiKey: DEFAULT_APIKEY, defaultModel: null, backgroundModel: null }

  let raw: string
  try {
    raw = await readFile(CCR_CONFIG_PATH, "utf-8")
  } catch(readError: unknown) {
    // Fallback path: the host runner normally scaffolds a persistent config before spawn.
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

  config.HOST = "127.0.0.1"
  // CCR rejects keyless requests and Claude Code needs a token, so inject one when absent.
  const apiKey = typeof config.APIKEY === "string" && config.APIKEY.length > 0 ? config.APIKEY : DEFAULT_APIKEY
  config.APIKEY = apiKey

  // Otherwise `ccr serve` writes an apiKeyHelper that fights our ANTHROPIC_AUTH_TOKEN.
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

  // CCR only catches an unserved Router slot at request time, as an opaque 400 mid-session.
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

// Logged to a file, never the TTY: `ccr serve`'s output would corrupt Claude Code's TUI.
const gatewayLogFd = openSync(CCR_LOG_PATH, "a")
const gateway = Bun.spawn([CCR_BIN, "serve", "--no-open"], {
  stdin: "ignore",
  stdout: gatewayLogFd,
  stderr: gatewayLogFd
})

type GatewayOutcome = "ready" | "exited" | "failed" | "timeout"

/** CCR logs this and then never binds the gateway port, so waiting the full timeout is pointless. */
const FATAL_LOG_MARKER = "No available models"

/** Polls /health, which answers 200 while still "starting", until the gateway can route. */
let lastProbeError: unknown = null
async function waitForGateway(port: number, timeoutMs: number): Promise<GatewayOutcome> {
  const deadline = Date.now() + timeoutMs
  while(Date.now() < deadline) {
    if(gateway.exitCode !== null) return "exited"
    const log = await readFile(CCR_LOG_PATH, "utf-8").catch(() => "")
    if(log.includes(FATAL_LOG_MARKER)) return "failed"
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
} else {
  // The log is classified first: CCR keeps its management server alive after refusing to bind
  // the gateway, so this is reached by timeout as often as by the child exiting.
  const log = await readFile(CCR_LOG_PATH, "utf-8").catch(() => "")
  console.warn("  [entrypoint] ⚠ The CCR gateway did not start — Claude Code will not be able to reach a model.")
  if(log.includes(FATAL_LOG_MARKER)) {
    console.warn("  [entrypoint]   CCR 3.x refuses to start unless at least one provider lists at least one model.")
    console.warn("  [entrypoint]   Add a non-empty \"models\": [...] to a provider in ~/.claude-code-router/config.json on the host.")
  } else if(gatewayOutcome === "timeout" && gateway.exitCode === null) {
    console.warn(`  [entrypoint]   Still not answering after 30s. See ${CCR_LOG_PATH}.`)
  } else {
    if(gateway.exitCode !== null) console.warn(`  [entrypoint]   \`ccr serve\` exited with code ${gateway.exitCode}.`)
    else if(lastProbeError) console.warn("  [entrypoint]   Last health probe failed:", lastProbeError)
    console.warn(`  [entrypoint]   Last lines of ${CCR_LOG_PATH}:`)
    for(const line of log.trimEnd().split("\n").slice(-15)) console.warn(`  [entrypoint]   | ${line}`)
  }
}

// Sourced by the wrappers and .bashrc, so `docker exec -it <container> claude` works too.
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

// The model vars use := so `ANTHROPIC_MODEL=x claude` still wins. Without gateway model
// discovery Claude Code rejects unrecognised model ids client-side, before any request.
const envFileLines = [
  `export ANTHROPIC_BASE_URL=${shellQuote(`http://127.0.0.1:${ccrConfig.port}`)}`,
  `export ANTHROPIC_AUTH_TOKEN=${shellQuote(ccrConfig.apiKey)}`,
  "export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1"
]
const modelDefaults: Record<string, string | null> = {
  ANTHROPIC_MODEL: ccrConfig.defaultModel,
  ANTHROPIC_DEFAULT_OPUS_MODEL: ccrConfig.defaultModel,
  ANTHROPIC_DEFAULT_SONNET_MODEL: ccrConfig.defaultModel,
  // Claude Code sends Haiku for titles and summaries; unmapped, those calls fail mid-session.
  ANTHROPIC_DEFAULT_HAIKU_MODEL: ccrConfig.backgroundModel
}
for(const [name, value] of Object.entries(modelDefaults)) {
  if(value) envFileLines.push(`: "\${${name}:=${value}}"; export ${name}`)
}
await writeFile(CCR_ENV_PATH, `${envFileLines.join("\n")}\n`, { mode: 0o600 })

const gatewayEnv: Record<string, string> = {
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${ccrConfig.port}`,
  ANTHROPIC_AUTH_TOKEN: ccrConfig.apiKey,
  CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1"
}
for(const [name, value] of Object.entries(modelDefaults)) {
  if(value && !process.env[name]) gatewayEnv[name] = value
}

// No Claude.ai OAuth is injected: a real subscription token could make Claude Code talk to
// Anthropic directly and ignore CCR's local endpoint.
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

// Pre-approved so Claude doesn't prompt "use this custom API key?".
if(!claudeJson.customApiKeyResponses) {
  claudeJson.customApiKeyResponses = { approved: [ccrConfig.apiKey], rejected: [] }
}

const APP_DIR = "/home/viber/app"
if(!claudeJson.projects) claudeJson.projects = {}
const projects = claudeJson.projects as Record<string, Record<string, unknown>>
if(!projects[APP_DIR]) projects[APP_DIR] = {}
projects[APP_DIR].hasTrustDialogAccepted = true

await writeFile(CLAUDE_JSON, JSON.stringify(claudeJson), { mode: 0o600 })

// Suppresses the bypass-permissions dialog, which is gated on this key, not the legacy flag.
let claudeSettings: Record<string, unknown> = {}
try {
  claudeSettings = JSON.parse(await readFile(CLAUDE_SETTINGS, "utf-8"))
} catch {
  claudeSettings = {}
}
claudeSettings.skipDangerousModePermissionPrompt = true
// A stray profile apiKeyHelper and our ANTHROPIC_AUTH_TOKEN are mutually exclusive.
delete claudeSettings.apiKeyHelper
await writeFile(CLAUDE_SETTINGS, JSON.stringify(claudeSettings, null, 2), { mode: 0o600 })

const gitUserName = process.env.GIT_USER_NAME
const gitUserEmail = process.env.GIT_USER_EMAIL
if(gitUserName) {
  await $`git config --global user.name ${gitUserName}`.quiet().nothrow()
}
if(gitUserEmail) {
  await $`git config --global user.email ${gitUserEmail}`.quiet().nothrow()
}

// Ignored at PID 1 so ctrl+c reaches bash's job control and kills only the foreground job.
process.on("SIGINT", () => {})
// `ccr serve` ignores SIGTERM in practice, so exiting PID 1 is what tears the container down.
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
