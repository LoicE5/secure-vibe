/**
 * Mistral Vibe container entrypoint (PID 1).
 *
 * Runs every time the Vibe provider container starts. Responsibilities:
 *   1. Seed the named brew volume from /opt/linuxbrew-seed on first run.
 *   2. Mirror the read-only ~/.vibe-host mount into a writable copy, remapping
 *      host-absolute ~/.vibe paths inside the mirrored config.toml ($VIBE_HOST_DIR →
 *      container ~/.vibe) so vibe doesn't crash mkdir-ing host paths like
 *      session_logging.save_dir. No credential file is written: the host runner
 *      injects $MISTRAL_API_KEY, and vibe resolves keys process-env-first (its
 *      ~/.vibe/.env load never overrides existing vars, and its keyring lookup
 *      fails gracefully without a daemon).
 *   3. Whitelist the workspace by adding "/home/viber/app" to the trusted array in
 *      ~/.vibe/trusted_folders.toml so vibe skips its workspace-trust dialog. The
 *      insert is idempotent and splices into an existing `trusted = [` array when
 *      the mirrored host file has one (a second top-level key would be invalid TOML).
 *   4. Inject the sandbox prompt into ~/.vibe/AGENTS.md (vibe has no
 *      --append-system-prompt flag; the user-level AGENTS.md is loaded into every
 *      session's system prompt). Marker-guarded so it's idempotent and keeps any
 *      existing user instructions.
 *   5. Apply host git identity from $GIT_USER_NAME / $GIT_USER_EMAIL.
 *   6. Ignore SIGINT at PID 1 so Ctrl+C kills only the foreground job (vibe)
 *      without exiting the shell.
 *   7. Spawn either the explicit command (and set $SECURE_VIBE_EXPLICIT_CMD=1
 *      so the bashrc auto-start guard skips vibe) or an interactive bash.
 *
 * The COPY directive in docker/vibe.dockerfile maps this file to the
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
const VIBE_DIR = `${HOME_DIR}/.vibe`

// Copy a read-only host mount into a writable copy (vibe writes logs/history/cache).
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

await mirror(`${HOME_DIR}/.vibe-host`, VIBE_DIR)

// The mirrored host config.toml can carry absolute host paths under the host's
// ~/.vibe — vibe's setup writes session_logging.save_dir that way — and vibe
// crashes at startup trying to mkdir them (e.g. /Users/loic/.vibe/logs/session).
// The runner passes the host's ~/.vibe path in $VIBE_HOST_DIR; remap every
// occurrence to the container's ~/.vibe, which we mirrored.
const hostVibeDir = process.env.VIBE_HOST_DIR
if(hostVibeDir && hostVibeDir !== VIBE_DIR) {
  const configPath = `${VIBE_DIR}/config.toml`
  const config = await readFile(configPath, "utf-8").catch(() => "")
  if(config.includes(hostVibeDir)) {
    await writeFile(configPath, config.replaceAll(hostVibeDir, VIBE_DIR), { mode: 0o600 })
  }
}

// The host runner injects the API key as an env var; vibe reads it directly
// (process env beats ~/.vibe/.env and the keyring), so no file write is needed.
if(!process.env.MISTRAL_API_KEY) {
  console.warn("  [entrypoint] MISTRAL_API_KEY not set — vibe will prompt for authentication.")
}

// Whitelist the workspace so vibe skips its workspace-trust dialog (shown when the
// repo carries agent-influencing files like AGENTS.md or .vibe/). Trust lives in
// ~/.vibe/trusted_folders.toml as a top-level `trusted = [...]` string array with
// ancestor matching. No TOML parser here: when the mirrored host file already has a
// `trusted = [` array we splice the path in right after the bracket (appending a
// second top-level key would be invalid TOML); otherwise we append/create the array.
// The substring check keeps it idempotent.
const APP_DIR = "/home/viber/app"
const trustedFoldersPath = `${VIBE_DIR}/trusted_folders.toml`
const existingTrust = await readFile(trustedFoldersPath, "utf-8").catch(() => "")
if(!existingTrust.includes(`"${APP_DIR}"`)) {
  // ^-anchored (multiline) so `untrusted = [` — the deny list — can never match.
  const arrayMatch = existingTrust.match(/^[ \t]*trusted\s*=\s*\[/m)
  let merged: string
  if(arrayMatch) {
    const insertAt = arrayMatch.index! + arrayMatch[0].length
    merged = `${existingTrust.slice(0, insertAt)}"${APP_DIR}", ${existingTrust.slice(insertAt)}`
  } else {
    const trustBlock = `trusted = ["${APP_DIR}"]\n`
    merged = existingTrust
      ? `${existingTrust.replace(/\s*$/, "")}\n\n${trustBlock}`
      : trustBlock
  }
  await mkdir(VIBE_DIR, { recursive: true })
  await writeFile(trustedFoldersPath, merged, { mode: 0o600 })
}

// vibe has no --append-system-prompt flag, so the sandbox prompt goes into the
// user-level ~/.vibe/AGENTS.md (loaded into every session's system prompt).
// Marker-guarded so it's idempotent and keeps existing context.
const SANDBOX_PROMPT_FILE = `${HOME_DIR}/.secure-vibe-sandbox.md`
const START_MARKER = "<!-- secure-vibe sandbox (start) -->"
const END_MARKER = "<!-- secure-vibe sandbox (end) -->"

const sandboxPrompt = await readFile(SANDBOX_PROMPT_FILE, "utf-8").catch(() => "")
if(sandboxPrompt) {
  await mkdir(VIBE_DIR, { recursive: true })
  const agentsMdPath = `${VIBE_DIR}/AGENTS.md`
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
// only reaches bash's job control, which kills the foreground job (vibe)
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
