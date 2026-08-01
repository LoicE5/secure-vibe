import { mkdir, writeFile, readFile, access } from "fs/promises"
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
const GEMINI_DIR = `${HOME_DIR}/.gemini`

/** Copies a read-only host mount into a writable copy; the host stays untouched. */
async function mirror(hostDir: string, targetDir: string): Promise<void> {
  const hostExists = await access(hostDir).then(() => true).catch(() => false)
  if(!hostExists) return
  await mkdir(targetDir, { recursive: true })
  const cpProc = Bun.spawn(
    ["bash", "-c", `shopt -s dotglob nullglob; cp -rp "${hostDir}/"* "${targetDir}/" 2>/dev/null; true`],
    { stdout: "pipe", stderr: "pipe" }
  )
  await cpProc.exited
}

await mirror(`${HOME_DIR}/.gemini-host`, GEMINI_DIR)

// agy skips the keyring when it detects /.dockerenv and reads this file instead.
const agyToken = process.env.AGY_OAUTH_TOKEN
if(agyToken) {
  const tokenDir = `${GEMINI_DIR}/antigravity-cli`
  await mkdir(tokenDir, { recursive: true })
  await writeFile(`${tokenDir}/antigravity-oauth-token`, agyToken, { mode: 0o600 })
}

// Folder trust is separate from tool approvals, so --dangerously-skip-permissions does not
// cover it. Merged into any mirrored host settings so other trusted paths survive.
const APP_DIR = "/home/viber/app"
const agySettingsDir = `${GEMINI_DIR}/antigravity-cli`
const agySettingsPath = `${agySettingsDir}/settings.json`
let agySettings: Record<string, unknown> = {}
const rawAgySettings = await readFile(agySettingsPath, "utf-8").catch(() => "")
if(rawAgySettings) {
  try {
    agySettings = JSON.parse(rawAgySettings) as Record<string, unknown>
  } catch(parseError: unknown) {
    console.warn("  [entrypoint] antigravity-cli/settings.json was not valid JSON; recreating it:", parseError)
    agySettings = {}
  }
}
const trustedRaw = agySettings.trustedWorkspaces
const trustedWorkspaces = Array.isArray(trustedRaw) ? trustedRaw as string[] : []
if(!trustedWorkspaces.includes(APP_DIR)) {
  trustedWorkspaces.push(APP_DIR)
  agySettings.trustedWorkspaces = trustedWorkspaces
  await mkdir(agySettingsDir, { recursive: true })
  await writeFile(agySettingsPath, JSON.stringify(agySettings, null, 2), { mode: 0o600 })
}

// No --append-system-prompt flag, so the prompt goes into the global instructions file.
const SANDBOX_PROMPT_FILE = `${HOME_DIR}/.secure-vibe-sandbox.md`
const START_MARKER = "<!-- secure-vibe sandbox (start) -->"
const END_MARKER = "<!-- secure-vibe sandbox (end) -->"

const sandboxPrompt = await readFile(SANDBOX_PROMPT_FILE, "utf-8").catch(() => "")
if(sandboxPrompt) {
  await mkdir(GEMINI_DIR, { recursive: true })
  const geminiMdPath = `${GEMINI_DIR}/GEMINI.md`
  const existing = await readFile(geminiMdPath, "utf-8").catch(() => "")

  let base = existing
  const startIdx = base.indexOf(START_MARKER)
  if(startIdx !== -1) {
    const endIdx = base.indexOf(END_MARKER, startIdx)
    if(endIdx !== -1) base = base.slice(0, startIdx) + base.slice(endIdx + END_MARKER.length)
  }

  const block = `${START_MARKER}\n${sandboxPrompt.trim()}\n${END_MARKER}`
  const merged = `${base.replace(/\s*$/, "")}\n\n${block}\n`.replace(/^\n+/, "")
  await writeFile(geminiMdPath, merged)
}

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
