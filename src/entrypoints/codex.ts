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
const CODEX_DIR = `${HOME_DIR}/.codex`

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

await mirror(`${HOME_DIR}/.codex-host`, CODEX_DIR)

// Written raw: the host runner already validated it carries tokens or an API key.
const credentials = process.env.CODEX_CREDENTIALS
if(credentials) {
  await mkdir(CODEX_DIR, { recursive: true })
  await writeFile(`${CODEX_DIR}/auth.json`, credentials, { mode: 0o600 })
} else {
  console.warn("  [entrypoint] CODEX_CREDENTIALS not set — codex will prompt for authentication.")
}

// Folder trust is separate from approvals, so the bypass flag does not cover it. No TOML
// parser here: appending a table at EOF is valid TOML and the substring check is idempotent.
const APP_DIR = "/home/viber/app"
const codexConfigPath = `${CODEX_DIR}/config.toml`
const trustHeader = `[projects."${APP_DIR}"]`
const existingConfig = await readFile(codexConfigPath, "utf-8").catch(() => "")
if(!existingConfig.includes(trustHeader)) {
  const trustBlock = `${trustHeader}\ntrust_level = "trusted"\n`
  const merged = existingConfig
    ? `${existingConfig.replace(/\s*$/, "")}\n\n${trustBlock}`
    : trustBlock
  await mkdir(CODEX_DIR, { recursive: true })
  await writeFile(codexConfigPath, merged, { mode: 0o600 })
}

// No --append-system-prompt flag, so the prompt goes into the global instructions file.
const SANDBOX_PROMPT_FILE = `${HOME_DIR}/.secure-vibe-sandbox.md`
const START_MARKER = "<!-- secure-vibe sandbox (start) -->"
const END_MARKER = "<!-- secure-vibe sandbox (end) -->"

const sandboxPrompt = await readFile(SANDBOX_PROMPT_FILE, "utf-8").catch(() => "")
if(sandboxPrompt) {
  await mkdir(CODEX_DIR, { recursive: true })
  const agentsMdPath = `${CODEX_DIR}/AGENTS.md`
  const existing = await readFile(agentsMdPath, "utf-8").catch(() => "")

  let base = existing
  const startIdx = base.indexOf(START_MARKER)
  if(startIdx !== -1) {
    const endIdx = base.indexOf(END_MARKER, startIdx)
    if(endIdx !== -1) base = base.slice(0, startIdx) + base.slice(endIdx + END_MARKER.length)
  }

  const block = `${START_MARKER}\n${sandboxPrompt.trim()}\n${END_MARKER}`
  const merged = `${base.replace(/\s*$/, "")}\n\n${block}\n`.replace(/^\n+/, "")
  await writeFile(agentsMdPath, merged)
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
