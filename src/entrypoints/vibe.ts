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
const VIBE_DIR = `${HOME_DIR}/.vibe`

/** Copies a read-only host mount into a writable copy, skipping the (huge, unread) log tree. */
async function mirror(hostDir: string, targetDir: string): Promise<void> {
  const hostExists = await access(hostDir).then(() => true).catch(() => false)
  if(!hostExists) return
  await mkdir(targetDir, { recursive: true })
  const cpProc = Bun.spawn(
    ["bash", "-c", `find "${hostDir}" -mindepth 1 -maxdepth 1 ! -name logs -exec cp -rp -t "${targetDir}" {} + 2>/dev/null; chmod -R u+w "${targetDir}" 2>/dev/null; true`],
    { stdout: "pipe", stderr: "pipe" }
  )
  await cpProc.exited
}

await mirror(`${HOME_DIR}/.vibe-host`, VIBE_DIR)

// vibe crashes at startup mkdir-ing the absolute host paths its own setup baked into
// config.toml. The lookahead keeps sibling prefixes (~/.vibe-backups vs ~/.vibe) intact.
const hostHome = process.env.SECURE_VIBE_HOST_HOME
if(hostHome) {
  const configPath = `${VIBE_DIR}/config.toml`
  const config = await readFile(configPath, "utf-8").catch(() => "")
  const escapedHostHome = hostHome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const remapped = config.replace(new RegExp(`${escapedHostHome}(?=["'/])`, "g"), HOME_DIR)
  if(remapped !== config) {
    await writeFile(configPath, remapped, { mode: 0o600 })
  }
}

if(!process.env.MISTRAL_API_KEY) {
  console.warn("  [entrypoint] MISTRAL_API_KEY not set — vibe will prompt for authentication.")
}

// vibe checks `trusted` before `untrusted`, so splicing in wins even if the host denied the
// path. No TOML parser here; both regexes are ^-anchored so `untrusted = [` never matches.
const APP_DIR = "/home/viber/app"
const trustedFoldersPath = `${VIBE_DIR}/trusted_folders.toml`
const existingTrust = await readFile(trustedFoldersPath, "utf-8").catch(() => "")
const trustedArray = existingTrust.match(/^[ \t]*trusted\s*=\s*\[[^\]]*/m)?.at(0) ?? ""
if(!trustedArray.includes(`"${APP_DIR}"`)) {
  const spliced = existingTrust.replace(/^([ \t]*trusted\s*=\s*\[)/m, `$1"${APP_DIR}", `)
  const trustBlock = `trusted = ["${APP_DIR}"]\n`
  const merged = spliced !== existingTrust
    ? spliced
    : existingTrust
      ? `${existingTrust.replace(/\s*$/, "")}\n\n${trustBlock}`
      : trustBlock
  await mkdir(VIBE_DIR, { recursive: true })
  await writeFile(trustedFoldersPath, merged, { mode: 0o600 })
}

// No --append-system-prompt flag, so the prompt goes into the global instructions file.
const SANDBOX_PROMPT_FILE = `${HOME_DIR}/.secure-vibe-sandbox.md`
const START_MARKER = "<!-- secure-vibe sandbox (start) -->"
const END_MARKER = "<!-- secure-vibe sandbox (end) -->"

const sandboxPrompt = await readFile(SANDBOX_PROMPT_FILE, "utf-8").catch(() => "")
if(sandboxPrompt) {
  await mkdir(VIBE_DIR, { recursive: true })
  const agentsMdPath = `${VIBE_DIR}/AGENTS.md`
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
