/**
 * CCR (claude-code-router) container entrypoint (PID 1).
 *
 * Runs every time the CCR provider container starts. Responsibilities:
 *   1. Seed the named brew volume from /opt/linuxbrew-seed on first run.
 *   2. Mirror the read-only ~/.claude-code-router-host mount into a writable
 *      ~/.claude-code-router (CCR writes logs/state there at runtime).
 *   3. If no config exists, scaffold a minimal starter config.json (with an
 *      example Ollama provider via host.docker.internal) and print a hint.
 *      If one was mirrored, normalise it: force NON_INTERACTIVE_MODE and pin
 *      HOST to 127.0.0.1 when no APIKEY is set — the server is never exposed.
 *   4. Optionally materialise host Anthropic credentials from $CLAUDE_CREDENTIALS
 *      (set by runCcrContainer) so a CCR route back to Anthropic starts logged in.
 *      Absent is fine — CCR may route entirely off-Anthropic.
 *   5. Apply host git identity from $GIT_USER_NAME / $GIT_USER_EMAIL.
 *   6. Ignore SIGINT at PID 1 so Ctrl+C kills only the foreground job (ccr/claude)
 *      without exiting the shell.
 *   7. Spawn either the explicit command (and set $SECURE_VIBE_EXPLICIT_CMD=1 so the
 *      bashrc auto-start guard skips ccr) or an interactive bash.
 *
 * Bypass-permissions: `ccr code` launches the `claude` CLI via PATH, which resolves to
 * our /home/viber/bin/claude wrapper (--dangerously-skip-permissions + sandbox prompt).
 * This entrypoint adds nothing on that front — the wrapper is the single source.
 *
 * The COPY directive in docker/ccr.dockerfile maps this file to the provider-agnostic
 * in-container path /home/viber/entrypoint.ts.
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
const CCR_DIR = `${HOME_DIR}/.claude-code-router`
const CCR_HOST_DIR = `${HOME_DIR}/.claude-code-router-host`
const CCR_CONFIG_PATH = `${CCR_DIR}/config.json`

// Copy a read-only host mount into a writable copy (CCR refreshes its own state).
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

await mkdir(CCR_DIR, { recursive: true })
await mirror(CCR_HOST_DIR, CCR_DIR)

const configExists = await access(CCR_CONFIG_PATH).then(() => true).catch(() => false)
if(!configExists) {
  // Scaffold a minimal, non-interactive starter. No APIKEY → CCR binds 127.0.0.1.
  // The example provider targets a host-machine Ollama (reachable only with `--local`).
  const scaffold = {
    _comment: "secure-vibe scaffolded this starter. Edit the host file at ~/.claude-code-router/config.json and re-run. Only $VARs referenced here are forwarded into the container (from your project .env, then host env).",
    NON_INTERACTIVE_MODE: true,
    HOST: "127.0.0.1",
    PORT: 3456,
    Providers: [
      {
        name: "ollama",
        api_base_url: "http://host.docker.internal:11434/v1/chat/completions",
        api_key: "ollama",
        models: ["qwen2.5-coder:latest"]
      }
    ],
    Router: {
      default: "ollama,qwen2.5-coder:latest"
    }
  }
  await writeFile(CCR_CONFIG_PATH, JSON.stringify(scaffold, null, 2), { mode: 0o600 })
  console.info("  [entrypoint] No CCR config found — wrote a starter ~/.claude-code-router/config.json.")
  console.info("  [entrypoint]   Edit it on the HOST (mounted read-only here) to add real providers/keys, then re-run.")
  console.info("  [entrypoint]   The example 'ollama' provider needs `secure-vibe --ccr --local` to reach a host model.")
} else {
  // Normalise the mirrored config: never let CCR prompt, and never expose the server.
  try {
    const raw = await readFile(CCR_CONFIG_PATH, "utf-8")
    const config = JSON.parse(raw) as Record<string, unknown>
    config.NON_INTERACTIVE_MODE = true
    // CCR only forces 127.0.0.1 itself when APIKEY is unset; mirror that guarantee
    // explicitly so a stray HOST:0.0.0.0 in the user's config can't bind wide here.
    if(!config.APIKEY) config.HOST = "127.0.0.1"
    await writeFile(CCR_CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 })
  } catch(parseError: unknown) {
    console.warn("  [entrypoint] ⚠ ~/.claude-code-router/config.json was not valid JSON; leaving it as-is:", parseError)
  }
}

// Optionally materialise host Anthropic credentials so a route back to Anthropic
// starts pre-authenticated. CLAUDE_CREDENTIALS carries a merged JSON (claudeAiOauth +
// onboarding metadata). Absent is fine — CCR may route entirely off-Anthropic.
const credentials = process.env.CLAUDE_CREDENTIALS
if(credentials) {
  const CLAUDE_DIR = `${HOME_DIR}/.claude`
  await mkdir(CLAUDE_DIR, { recursive: true })

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(credentials) as Record<string, unknown>
  } catch(parseError: unknown) {
    console.warn("  [entrypoint] CLAUDE_CREDENTIALS was not valid JSON; skipping Anthropic pre-auth:", parseError)
    parsed = {}
  }

  if(Object.keys(parsed).length > 0) {
    if(!parsed.hasCompletedOnboarding) parsed.hasCompletedOnboarding = true
    if(!parsed.bypassPermissionsModeAccepted) parsed.bypassPermissionsModeAccepted = true

    const APP_DIR = "/home/viber/app"
    if(!parsed.projects) parsed.projects = {}
    const projects = parsed.projects as Record<string, Record<string, unknown>>
    if(!projects[APP_DIR]) projects[APP_DIR] = {}
    if(!projects[APP_DIR].hasTrustDialogAccepted) projects[APP_DIR].hasTrustDialogAccepted = true

    await writeFile(`${HOME_DIR}/.claude.json`, JSON.stringify(parsed), { mode: 0o600 })

    const authOnly = JSON.stringify({
      claudeAiOauth: parsed.claudeAiOauth,
      organizationUuid: parsed.organizationUuid
    })
    await writeFile(`${CLAUDE_DIR}/.credentials.json`, authOnly, { mode: 0o600 })
  }
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
// only reaches bash's job control, which kills the foreground job (ccr/claude)
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
