/**
 * CCR (claude-code-router) container entrypoint (PID 1).
 *
 * Runs every time the CCR provider container starts. Responsibilities:
 *   1. Seed the named brew volume from /opt/linuxbrew-seed on first run.
 *   2. Mirror the read-only ~/.claude-code-router-host mount into a writable
 *      ~/.claude-code-router (CCR writes logs/state there at runtime).
 *   3. Pin HOST to 127.0.0.1 when no APIKEY is set so the router is never bound
 *      wide. NON_INTERACTIVE_MODE is left to the user: forcing it would pipe+close
 *      claude's stdin and set TERM=dumb, breaking the interactive Claude Code session
 *      that is secure-vibe's main mode. (If somehow no config was mounted — the host
 *      runner normally scaffolds a persistent one — fall back to an ephemeral starter.)
 *   4. Pre-accept Claude Code's first-run flags (onboarding, trust, bypass) in
 *      ~/.claude.json so it launches straight into a session with no wizard — done
 *      unconditionally since CCR users usually have no Anthropic account. No OAuth is
 *      injected (it could make Claude bypass CCR and hit Anthropic directly).
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
// Image-baked starter (src/assets/ccr-starter-config.json, COPYed in by the Dockerfile). Same
// single source the host runner imports, so the host and fallback scaffolds never drift.
const CCR_STARTER_CONFIG_PATH = `${HOME_DIR}/.ccr-starter-config.json`

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
  // No config mounted — scaffold the image-baked starter into an EPHEMERAL in-container copy
  // (lost on exit). The host runner normally scaffolds a persistent config before spawn, so
  // reaching here is the fallback path. We copy the bundled asset (the same single source the
  // host runner uses) so the two scaffolds can't drift. APIKEY in it is a dummy so Claude Code
  // (which receives it as its auth token from CCR) treats itself as authenticated and skips
  // the onboarding wizard.
  try {
    const starter = await readFile(CCR_STARTER_CONFIG_PATH, "utf-8")
    await writeFile(CCR_CONFIG_PATH, starter, { mode: 0o600 })
    console.warn("  [entrypoint] ⚠ No CCR config was mounted — using an ephemeral in-container starter (lost on exit).")
    console.warn("  [entrypoint]   Create ~/.claude-code-router/config.json on the HOST (or re-run from the host) to persist it.")
  } catch(starterError: unknown) {
    console.warn("  [entrypoint] ⚠ No CCR config was mounted and the bundled starter could not be read:", starterError)
    console.warn("  [entrypoint]   Create ~/.claude-code-router/config.json on the HOST (or re-run from the host).")
  }
} else {
  // Two safety fixes, written only to the in-container writable mirror (the host file is
  // never touched). We deliberately do NOT touch NON_INTERACTIVE_MODE — forcing it would
  // break the interactive Claude Code session.
  //
  //  1. Pin HOST to loopback unconditionally. The container publishes no ports, so this
  //     can't be reached from the host regardless, but it keeps the "never bind wide"
  //     guarantee even now that we may inject an APIKEY below.
  //  2. Inject a dummy APIKEY when none is set. CCR passes the configured APIKEY to Claude
  //     Code as its auth token; with no key Claude receives an EMPTY token, treats itself
  //     as logged-out, and re-runs the onboarding/login wizard — ignoring the flags we seed
  //     below. A non-empty token makes Claude consider itself authenticated so those flags
  //     take effect. Only inject when absent, so a real user-set APIKEY is respected.
  try {
    const raw = await readFile(CCR_CONFIG_PATH, "utf-8")
    const config = JSON.parse(raw) as Record<string, unknown>
    config.HOST = "127.0.0.1"
    if(!config.APIKEY) config.APIKEY = "secure-vibe"
    await writeFile(CCR_CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 })
  } catch(parseError: unknown) {
    console.warn("  [entrypoint] ⚠ ~/.claude-code-router/config.json was not valid JSON; leaving it as-is:", parseError)
  }
}

// Pre-accept Claude Code's first-run flags so it launches straight into a session
// instead of the onboarding wizard (theme picker, trust-folder, bypass warning).
// CCR users typically have NO Anthropic account — CCR supplies the endpoint and token —
// so we seed these UNCONDITIONALLY (the claude provider only does it alongside creds).
//
// We deliberately do NOT inject Claude.ai OAuth here: a real subscription token can make
// Claude Code talk to Anthropic directly and ignore CCR's local endpoint, defeating routing.
const CLAUDE_DIR = `${HOME_DIR}/.claude`
const CLAUDE_JSON = `${HOME_DIR}/.claude.json`
await mkdir(CLAUDE_DIR, { recursive: true })

let claudeJson: Record<string, unknown> = {}
try {
  claudeJson = JSON.parse(await readFile(CLAUDE_JSON, "utf-8")) as Record<string, unknown>
} catch {
  claudeJson = {}
}

claudeJson.hasCompletedOnboarding = true
claudeJson.bypassPermissionsModeAccepted = true
if(!claudeJson.theme) claudeJson.theme = "dark"

// Pre-approve the custom API key so Claude doesn't prompt "use this custom API key?".
// It keys this on the token CCR forwards (the config's APIKEY — "secure-vibe" by default,
// injected above when the user set none). Harmless if a real APIKEY is used; the prompt
// just won't be pre-answered for that key, which is fine.
if(!claudeJson.customApiKeyResponses) {
  claudeJson.customApiKeyResponses = { approved: ["secure-vibe"], rejected: [] }
}

const APP_DIR = "/home/viber/app"
if(!claudeJson.projects) claudeJson.projects = {}
const projects = claudeJson.projects as Record<string, Record<string, unknown>>
if(!projects[APP_DIR]) projects[APP_DIR] = {}
projects[APP_DIR].hasTrustDialogAccepted = true

await writeFile(CLAUDE_JSON, JSON.stringify(claudeJson), { mode: 0o600 })

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
