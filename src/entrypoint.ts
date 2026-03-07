import { mkdir, writeFile, access, rm } from "fs/promises"

// ── Seed linuxbrew volume on first run ────────────────────────────────────────
// The named volume at /home/linuxbrew starts empty; copy from the seed baked
// into the image. Subsequent runs skip this entirely.
const brewReady = await access("/home/linuxbrew/.linuxbrew").then(() => true).catch(() => false)
if (!brewReady) {
  console.info("  [entrypoint] First run: seeding brew volume from image (this may take a minute)…")
  const seed = Bun.spawn(["cp", "-a", "/opt/linuxbrew-seed/.", "/home/linuxbrew/"], {
    stdout: "inherit",
    stderr: "inherit",
  })
  await seed.exited
  console.info("  [entrypoint] Brew volume ready.")
}

const CLAUDE_DIR = "/home/viber/.claude"
const CLAUDE_HOST_DIR = "/home/viber/.claude-host"
const HOME_DIR = "/home/viber"

await mkdir(CLAUDE_DIR, { recursive: true })

// Copy contents of .claude-host into .claude.
// Uses bash with dotglob so hidden files are included alongside regular ones.
const hostDirExists = await access(CLAUDE_HOST_DIR).then(() => true).catch(() => false)
if (hostDirExists) {
  const cpProc = Bun.spawn(
    ["bash", "-c", `shopt -s dotglob nullglob; cp -rp "${CLAUDE_HOST_DIR}/"* "${CLAUDE_DIR}/" 2>/dev/null; true`],
    { stdout: "pipe", stderr: "pipe" }
  )
  await cpProc.exited
}

// Inject credentials from the env var set by index.ts.
// CLAUDE_CREDENTIALS contains a merged JSON with claudeAiOauth + onboarding metadata.
// Write the full object to ~/.claude.json (Claude 2.1.63+ primary location) and
// write just the auth fields to ~/.claude/.credentials.json (older Claude fallback).
const credentials = process.env.CLAUDE_CREDENTIALS
if (credentials) {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(credentials) as Record<string, unknown>
  } catch {
    parsed = {}
  }

  // ~/.claude.json — full merged config (auth + onboarding state)
  // Ensure onboarding flags are set so Claude skips first-run setup prompts.
  // Keychain-sourced credentials only carry auth tokens, not UI state.
  if (!parsed.hasCompletedOnboarding) parsed.hasCompletedOnboarding = true
  await writeFile(`${HOME_DIR}/.claude.json`, JSON.stringify(parsed), { mode: 0o600 })

  // ~/.claude/.credentials.json — auth fields only (legacy fallback)
  const authOnly = JSON.stringify({
    claudeAiOauth: parsed.claudeAiOauth,
    organizationUuid: parsed.organizationUuid,
  })
  await rm(`${CLAUDE_DIR}/.credentials.json`, { recursive: true, force: true })
  await writeFile(`${CLAUDE_DIR}/.credentials.json`, authOnly, { mode: 0o600 })
} else {
  console.warn("  [entrypoint] CLAUDE_CREDENTIALS not set — Claude will prompt for authentication.")
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
