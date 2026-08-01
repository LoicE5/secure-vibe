import { mkdir, writeFile, readFile, access, rm } from "fs/promises"
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

const CLAUDE_DIR = "/home/viber/.claude"
const CLAUDE_HOST_DIR = "/home/viber/.claude-host"
const CLAUDE_SETTINGS = `${CLAUDE_DIR}/settings.json`
const HOME_DIR = "/home/viber"

await mkdir(CLAUDE_DIR, { recursive: true })

const hostDirExists = await access(CLAUDE_HOST_DIR).then(() => true).catch(() => false)
if(hostDirExists) {
  const cpProc = Bun.spawn(
    ["bash", "-c", `shopt -s dotglob nullglob; cp -rp "${CLAUDE_HOST_DIR}/"* "${CLAUDE_DIR}/" 2>/dev/null; true`],
    { stdout: "pipe", stderr: "pipe" }
  )
  await cpProc.exited
}

const credentials = process.env.CLAUDE_CREDENTIALS
if(credentials) {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(credentials) as Record<string, unknown>
  } catch(parseError: unknown) {
    console.warn("  [entrypoint] CLAUDE_CREDENTIALS was not valid JSON; using empty config:", parseError)
    parsed = {}
  }

  // Keychain creds carry auth tokens but no UI state, so the onboarding flags are set here.
  if(!parsed.hasCompletedOnboarding) parsed.hasCompletedOnboarding = true

  const APP_DIR = "/home/viber/app"
  if(!parsed.projects) parsed.projects = {}
  const projects = parsed.projects as Record<string, Record<string, unknown>>
  if(!projects[APP_DIR]) projects[APP_DIR] = {}
  if(!projects[APP_DIR].hasTrustDialogAccepted) projects[APP_DIR].hasTrustDialogAccepted = true

  await writeFile(`${HOME_DIR}/.claude.json`, JSON.stringify(parsed), { mode: 0o600 })

  // Legacy fallback location, auth fields only.
  const authOnly = JSON.stringify({
    claudeAiOauth: parsed.claudeAiOauth,
    organizationUuid: parsed.organizationUuid
  })
  await rm(`${CLAUDE_DIR}/.credentials.json`, { recursive: true, force: true })
  await writeFile(`${CLAUDE_DIR}/.credentials.json`, authOnly, { mode: 0o600 })
} else {
  console.warn("  [entrypoint] CLAUDE_CREDENTIALS not set — Claude will prompt for authentication.")
}

// Suppresses the bypass-permissions dialog, which is gated on this key, not the legacy flag.
let claudeSettings: Record<string, unknown> = {}
try {
  claudeSettings = JSON.parse(await readFile(CLAUDE_SETTINGS, "utf-8")) as Record<string, unknown>
} catch {
  claudeSettings = {}
}
claudeSettings.skipDangerousModePermissionPrompt = true
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

const cmd = process.argv.slice(2)
const isExplicitCmd = cmd.length > 0
const childEnv = isExplicitCmd
  ? { ...process.env, SECURE_VIBE_EXPLICIT_CMD: "1" }
  : process.env

const proc = Bun.spawn(isExplicitCmd ? cmd : ["bash", "-i"], {
  env: childEnv,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit"
})

process.exit(await proc.exited)
