/**
 * Antigravity container entrypoint (PID 1).
 *
 * Runs every time the Antigravity provider container starts. Responsibilities:
 *   1. Seed the named brew volume from /opt/linuxbrew-seed on first run.
 *   2. Mirror the read-only ~/.config/agy-host and ~/.gemini-host mounts into
 *      writable copies (agy needs to write/refresh tokens and state).
 *   3. Inject the sandbox prompt into ~/.gemini/GEMINI.md (agy has no
 *      --append-system-prompt flag; the global GEMINI.md is prepended to every
 *      prompt). Written in a marker-guarded block so it's idempotent and never
 *      clobbers global context mirrored from the host.
 *   4. Apply host git identity from $GIT_USER_NAME / $GIT_USER_EMAIL.
 *   5. Ignore SIGINT at PID 1 so Ctrl+C kills only the foreground job (agy)
 *      without exiting the shell.
 *   6. Spawn either the explicit command (and set $SECURE_VIBE_EXPLICIT_CMD=1
 *      so the bashrc auto-start guard skips agy) or an interactive bash.
 *
 * The COPY directive in docker/antigravity.dockerfile maps this file to the
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
const GEMINI_DIR = `${HOME_DIR}/.gemini`
const AGY_DIR = `${HOME_DIR}/.config/agy`

// Copy a read-only host mount into a writable copy (agy refreshes tokens/state).
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

await mirror(`${HOME_DIR}/.config/agy-host`, AGY_DIR)
await mirror(`${HOME_DIR}/.gemini-host`, GEMINI_DIR)

// agy has no --append-system-prompt flag, so the sandbox prompt goes into the
// global ~/.gemini/GEMINI.md. Marker-guarded so it's idempotent and keeps any host context.
const SANDBOX_PROMPT_FILE = `${HOME_DIR}/.secure-vibe-sandbox.md`
const START_MARKER = "<!-- secure-vibe sandbox (start) -->"
const END_MARKER = "<!-- secure-vibe sandbox (end) -->"

const sandboxPrompt = await readFile(SANDBOX_PROMPT_FILE, "utf-8").catch(() => "")
if(sandboxPrompt) {
  await mkdir(GEMINI_DIR, { recursive: true })
  const geminiMdPath = `${GEMINI_DIR}/GEMINI.md`
  const existing = await readFile(geminiMdPath, "utf-8").catch(() => "")

  // Strip any previous secure-vibe block, then append a fresh one.
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
// only reaches bash's job control, which kills the foreground job (agy)
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
