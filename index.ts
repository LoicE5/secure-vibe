import { access, constants, readFile } from "fs/promises"
import { createInterface } from "readline"
import { homedir, userInfo } from "os"
import { resolve, join } from "path"

// ── Helpers ───────────────────────────────────────────────────────────────────

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const stat = await Bun.file(path).stat()
    return stat.isDirectory()
  } catch {
    return false
  }
}

async function commandExists(command: string): Promise<boolean> {
  return Bun.which(command) !== null
}

async function testRuntime(runtime: string): Promise<boolean> {
  const proc = Bun.spawn([runtime, "info"], {
    stdout: "pipe",
    stderr: "pipe"
  })
  return await proc.exited === 0
}

function isBannedDirectory(absolutePath: string): boolean {
  const home = homedir()
  const banned = [
    home,
    "/",
    "/etc",
    "/usr",
    "/bin",
    "/sbin",
    "/lib",
    "/lib64",
    "/var",
    "/tmp",
    "/proc",
    "/sys",
    "/dev",
    "/boot"
  ]
  return banned.some(bannedPath => absolutePath === bannedPath)
}

// ── Step 1: Directory selection ───────────────────────────────────────────────

async function selectDirectory(): Promise<string> {
  while (true) {
    const input = await prompt("Directory to mount (leave blank for current directory): ")
    const targetPath = input === "" ? process.cwd() : resolve(input)

    if (!(await isDirectory(targetPath))) {
      console.error(`  ✗ Not a valid directory: ${targetPath}`)
      continue
    }

    if (isBannedDirectory(targetPath)) {
      console.error(`  ✗ Mounting "${targetPath}" is not allowed for security reasons.`)
      continue
    }

    return targetPath
  }
}

// ── Step 2: Runtime detection ─────────────────────────────────────────────────

type Runtime = "docker" | "podman"

async function selectRuntime(): Promise<Runtime> {
  const dockerAvailable = (await commandExists("docker")) && (await testRuntime("docker"))
  const podmanAvailable = (await commandExists("podman")) && (await testRuntime("podman"))

  if (!dockerAvailable && !podmanAvailable) {
    console.error("✗ Neither docker nor podman is available or running. Please start one and try again.")
    process.exit(1)
  }

  if (dockerAvailable && !podmanAvailable) {
    console.info("  Using docker.")
    return "docker"
  }

  if (podmanAvailable && !dockerAvailable) {
    console.info("  Using podman.")
    return "podman"
  }

  // Both available — check env preference first
  const envPreference = process.env.RUNTIME?.toLowerCase()
  if (envPreference === "docker") return "docker"
  if (envPreference === "podman") return "podman"

  // Prompt
  while (true) {
    const answer = await prompt("Both docker and podman are available. Which one to use? [docker/podman]: ")
    const normalized = answer.toLowerCase()
    if (normalized === "docker" || normalized === "podman") return normalized as Runtime
    console.error('  ✗ Please enter "docker" or "podman".')
  }
}

// ── Step 3: Credential resolution ────────────────────────────────────────────

const CLAUDE_DIR = join(homedir(), ".claude")
const CLAUDE_JSON_PATH = join(homedir(), ".claude.json")

// Reads ~/.claude.json and extracts the auth fields Claude needs.
// Claude 2.1.63+ stores credentials there (not in ~/.claude/.credentials.json).
async function readClaudeJson(): Promise<string | null> {
  const exists = await access(CLAUDE_JSON_PATH, constants.R_OK).then(() => true).catch(() => false)
  if (!exists) return null

  try {
    const content = JSON.parse(await readFile(CLAUDE_JSON_PATH, "utf-8")) as Record<string, unknown>
    if (!content.claudeAiOauth) return null
    return JSON.stringify({
      claudeAiOauth: content.claudeAiOauth,
      organizationUuid: content.organizationUuid
    })
  } catch (readError: unknown) {
    console.warn("  Could not parse ~/.claude.json:", readError)
    return null
  }
}

// Returns the credentials JSON string to inject into the container via env var,
// or null if credentials are already present in the mounted .claude-host dir.
async function resolveCredentials(): Promise<string | null> {
  // Primary: read from ~/.claude.json (Claude 2.1.63+, works on all platforms)
  const fromFile = await readClaudeJson()
  if (fromFile) {
    console.info("  Credentials read from ~/.claude.json.")
    return fromFile
  }

  // macOS fallback: pull from keychain (older Claude or fresh install)
  if (process.platform === "darwin") {
    console.info("  ~/.claude.json not found. Trying macOS keychain…")
    try {
      const serviceName = "Claude Code-credentials"
      const credentialsJson = (await Bun.$`security find-generic-password -s ${serviceName} -w`.text()).trim()
      if (!credentialsJson) {
        console.error("✗ Keychain entry for 'Claude Code-credentials' was empty.")
        process.exit(1)
      }
      console.info("  Credentials extracted from keychain.")
      return credentialsJson
    } catch (keychainError: unknown) {
      console.error("✗ Failed to read credentials from keychain:", keychainError)
      process.exit(1)
    }
  }

  // Linux: check old .credentials.json location as last resort
  const legacyFile = join(CLAUDE_DIR, ".credentials.json")
  const legacyExists = await access(legacyFile, constants.R_OK).then(() => true).catch(() => false)
  if (legacyExists) {
    const content = await readFile(legacyFile, "utf-8")
    console.info("  Credentials read from ~/.claude/.credentials.json.")
    return content
  }

  console.error("✗ No credentials found. Please authenticate with Claude Code on this machine first.")
  process.exit(1)
}

// ── Step 4: Image check + build ───────────────────────────────────────────────

const IMAGE_NAME = "secure-vibe"
const SCRIPT_DIR = import.meta.dir

async function ensureImage(runtime: Runtime): Promise<void> {
  const imageId = (await Bun.$`${runtime} images ${IMAGE_NAME} -q`.text()).trim()

  if (imageId !== "") {
    console.info(`  Image "${IMAGE_NAME}" found.`)
    return
  }

  console.info(`  Image "${IMAGE_NAME}" not found. Building…`)

  const { uid, gid } = userInfo()

  const buildProcess = Bun.spawn(
    [
      runtime, "build",
      "--build-arg", `UID=${uid}`,
      "--build-arg", `GID=${gid}`,
      "-t", IMAGE_NAME,
      SCRIPT_DIR
    ],
    { stdin: "inherit", stdout: "inherit", stderr: "inherit" }
  )

  const buildExit = await buildProcess.exited
  if (buildExit !== 0) {
    console.error(`✗ Image build failed (exit ${buildExit}).`)
    process.exit(buildExit ?? 1)
  }

  console.info(`  Image "${IMAGE_NAME}" built successfully.`)
}

// ── Step 5: Run container ─────────────────────────────────────────────────────

async function runContainer(
  runtime: Runtime,
  workDir: string,
  credentialsJson: string | null
): Promise<number> {
  const args = [
    runtime, "run", "--rm", "-it",
    "-v", `${workDir}:/home/viber/app`,
    // Mount as read-only so the container never writes back to the host's ~/.claude.
    // The entrypoint copies it to a writable location inside the container.
    "-v", `${CLAUDE_DIR}:/home/viber/.claude-host:ro`
  ]

  if (credentialsJson) {
    // Pass credentials as an env var; entrypoint writes them to .credentials.json
    // inside the container. Nothing is ever written to the host's ~/.claude.
    args.push("-e", `CLAUDE_CREDENTIALS=${credentialsJson}`)
  }

  args.push(IMAGE_NAME)

  const containerProcess = Bun.spawn(args, { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
  return await containerProcess.exited ?? 0
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.info("── secure-vibe ──────────────────────────────────────────")

const workDir = await selectDirectory()
console.info(`  Mounting: ${workDir}`)

const runtime = await selectRuntime()
const credentialsJson = await resolveCredentials()

await ensureImage(runtime)
const exitCode = await runContainer(runtime, workDir, credentialsJson)
process.exit(exitCode)
