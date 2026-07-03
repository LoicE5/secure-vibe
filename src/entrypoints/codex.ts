/**
 * Codex container entrypoint (PID 1).
 *
 * Runs every time the Codex provider container starts. Responsibilities:
 *   1. Seed the named brew volume from /opt/linuxbrew-seed on first run.
 *   2. Mirror the read-only ~/.codex-host mount into a writable copy, then write
 *      the host auth ($CODEX_CREDENTIALS) to ~/.codex/auth.json so the session
 *      starts logged in (codex refreshes tokens against its own copy; the host
 *      file is never touched).
 *   3. Whitelist the workspace by adding a [projects."/home/viber/app"] table
 *      with trust_level = "trusted" to ~/.codex/config.toml so codex skips its
 *      "Do you trust this folder?" dialog (--dangerously-bypass-approvals-and-sandbox
 *      only covers approvals/sandboxing, not folder trust). Appended so any
 *      mirrored host config survives.
 *   4. Inject the sandbox prompt into ~/.codex/AGENTS.md (codex has no
 *      --append-system-prompt flag; the global AGENTS.md is prepended to every
 *      session). Marker-guarded so it's idempotent and keeps any existing context.
 *   5. Apply host git identity from $GIT_USER_NAME / $GIT_USER_EMAIL.
 *   6. Ignore SIGINT at PID 1 so Ctrl+C kills only the foreground job (codex)
 *      without exiting the shell.
 *   7. Spawn either the explicit command (and set $SECURE_VIBE_EXPLICIT_CMD=1
 *      so the bashrc auto-start guard skips codex) or an interactive bash.
 *
 * The COPY directive in docker/codex.dockerfile maps this file to the
 * provider-agnostic in-container path /home/viber/entrypoint.ts.
 */

import { mkdir, writeFile, readFile, access } from "fs/promises"
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
const CODEX_DIR = `${HOME_DIR}/.codex`

// Copy a read-only host mount into a writable copy (codex refreshes its own state).
// dotglob so hidden files come along; the host stays untouched.
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

// Write the host's Codex auth to the file codex reads (plaintext JSON on every
// platform), so the session starts logged in. Written raw — the host runner
// already validated it carries tokens or an API key.
const credentials = process.env.CODEX_CREDENTIALS
if(credentials) {
  await mkdir(CODEX_DIR, { recursive: true })
  await writeFile(`${CODEX_DIR}/auth.json`, credentials, { mode: 0o600 })
} else {
  console.warn("  [entrypoint] CODEX_CREDENTIALS not set — codex will prompt for authentication.")
}

// Whitelist the workspace so codex skips its "Do you trust this folder?" dialog
// (the wrapper's --dangerously-bypass-approvals-and-sandbox only covers approvals
// and sandboxing, not folder trust). codex stores trust as a per-project table in
// ~/.codex/config.toml. No TOML parser here: appending a table at EOF is valid
// TOML, and the substring check keeps it idempotent — a mirrored host config that
// already mentions the path is left alone.
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

// codex has no --append-system-prompt flag, so the sandbox prompt goes into the
// global ~/.codex/AGENTS.md. Marker-guarded so it's idempotent and keeps existing context.
const SANDBOX_PROMPT_FILE = `${HOME_DIR}/.secure-vibe-sandbox.md`
const START_MARKER = "<!-- secure-vibe sandbox (start) -->"
const END_MARKER = "<!-- secure-vibe sandbox (end) -->"

const sandboxPrompt = await readFile(SANDBOX_PROMPT_FILE, "utf-8").catch(() => "")
if(sandboxPrompt) {
  await mkdir(CODEX_DIR, { recursive: true })
  const agentsMdPath = `${CODEX_DIR}/AGENTS.md`
  const existing = await readFile(agentsMdPath, "utf-8").catch(() => "")

  // Strip any previous secure-vibe block, then append a fresh one.
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
// only reaches bash's job control, which kills the foreground job (codex)
// without terminating the shell itself.
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
