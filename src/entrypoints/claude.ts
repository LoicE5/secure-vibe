/**
 * Claude container entrypoint (PID 1).
 *
 * Runs every time the Claude provider container starts. Responsibilities:
 *   1. Seed the named brew volume from /opt/linuxbrew-seed on first run.
 *   2. Mirror the read-only ~/.claude-host mount into a writable ~/.claude.
 *   3. Materialise credentials from $CLAUDE_CREDENTIALS (set by the host
 *      runClaudeContainer) into ~/.claude.json and ~/.claude/.credentials.json,
 *      pre-toggling the onboarding/permission flags so Claude doesn't prompt.
 *   4. Apply host git identity from $GIT_USER_NAME / $GIT_USER_EMAIL.
 *   5. Ignore SIGINT at PID 1 so Ctrl+C kills only the foreground job
 *      (claude) without exiting the shell.
 *   6. Spawn either the explicit command (and set $SECURE_VIBE_EXPLICIT_CMD=1
 *      so the bashrc auto-start guard skips Claude) or an interactive bash.
 *
 * The COPY directive in docker/claude.dockerfile maps this file to the
 * provider-agnostic in-container path /home/viber/entrypoint.ts so future
 * provider Dockerfiles can swap their own entrypoint behind the same path.
 */

import { mkdir, writeFile, readFile, access, rm } from "fs/promises"
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

const CLAUDE_DIR = "/home/viber/.claude"
const CLAUDE_HOST_DIR = "/home/viber/.claude-host"
const CLAUDE_SETTINGS = `${CLAUDE_DIR}/settings.json`
const HOME_DIR = "/home/viber"

await mkdir(CLAUDE_DIR, { recursive: true })

// Copy contents of .claude-host into .claude.
// Uses bash with dotglob so hidden files are included alongside regular ones.
const hostDirExists = await access(CLAUDE_HOST_DIR).then(() => true).catch(() => false)
if(hostDirExists) {
  const cpProc = Bun.spawn(
    ["bash", "-c", `shopt -s dotglob nullglob; cp -rp "${CLAUDE_HOST_DIR}/"* "${CLAUDE_DIR}/" 2>/dev/null; true`],
    { stdout: "pipe", stderr: "pipe" }
  )
  await cpProc.exited
}

// Inject credentials from the env var set by runClaudeContainer.
// CLAUDE_CREDENTIALS contains a merged JSON with claudeAiOauth + onboarding metadata.
// Write the full object to ~/.claude.json (Claude 2.1.63+ primary location) and
// write just the auth fields to ~/.claude/.credentials.json (older Claude fallback).
const credentials = process.env.CLAUDE_CREDENTIALS
if(credentials) {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(credentials) as Record<string, unknown>
  } catch(parseError: unknown) {
    console.warn("  [entrypoint] CLAUDE_CREDENTIALS was not valid JSON; using empty config:", parseError)
    parsed = {}
  }

  // ~/.claude.json — full merged config. Keychain creds carry only auth tokens, not UI state,
  // so set onboarding here; the bypass warning is pre-accepted in settings.json below.
  if(!parsed.hasCompletedOnboarding) parsed.hasCompletedOnboarding = true

  const APP_DIR = "/home/viber/app"
  if(!parsed.projects) parsed.projects = {}
  const projects = parsed.projects as Record<string, Record<string, unknown>>
  if(!projects[APP_DIR]) projects[APP_DIR] = {}
  if(!projects[APP_DIR].hasTrustDialogAccepted) projects[APP_DIR].hasTrustDialogAccepted = true

  await writeFile(`${HOME_DIR}/.claude.json`, JSON.stringify(parsed), { mode: 0o600 })

  // ~/.claude/.credentials.json — auth fields only (legacy fallback)
  const authOnly = JSON.stringify({
    claudeAiOauth: parsed.claudeAiOauth,
    organizationUuid: parsed.organizationUuid
  })
  await rm(`${CLAUDE_DIR}/.credentials.json`, { recursive: true, force: true })
  await writeFile(`${CLAUDE_DIR}/.credentials.json`, authOnly, { mode: 0o600 })
} else {
  console.warn("  [entrypoint] CLAUDE_CREDENTIALS not set — Claude will prompt for authentication.")
}

// Suppress the bypass-permissions warning dialog (modern Claude Code gates it on this
// settings key, not the legacy ~/.claude.json bypassPermissionsModeAccepted flag).
let claudeSettings: Record<string, unknown> = {}
try {
  claudeSettings = JSON.parse(await readFile(CLAUDE_SETTINGS, "utf-8")) as Record<string, unknown>
} catch {
  claudeSettings = {}
}
claudeSettings.skipDangerousModePermissionPrompt = true
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
