import { access, constants, mkdtemp, cp, writeFile, rm } from "fs/promises"
import { createInterface } from "readline"
import { homedir, userInfo } from "os"
import { resolve, join } from "path"
import { tmpdir } from "os"

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
  const process = Bun.spawn([runtime, "info"], {
    stdout: "pipe",
    stderr: "pipe"
  })
  return await process.exited === 0
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
const CREDENTIALS_FILE = join(CLAUDE_DIR, ".credentials.json")

async function resolveCredentials(): Promise<{ claudeHostPath: string; tempDir: string | null }> {
  const credentialsExist = await access(CREDENTIALS_FILE, constants.R_OK)
    .then(() => true)
    .catch(() => false)

  if (credentialsExist) {
    return { claudeHostPath: CLAUDE_DIR, tempDir: null }
  }

  if (process.platform !== "darwin") {
    console.error(
      `✗ No credentials found at ${CREDENTIALS_FILE}.\n` +
      "  On Linux, ~/.claude/.credentials.json is required. Please authenticate with Claude Code first."
    )
    process.exit(1)
  }

  // macOS: extract from keychain
  console.info("  ~/.claude/.credentials.json not found. Attempting to read from macOS keychain…")

  const keychainProcess = Bun.spawn(
    ["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
    { stdout: "pipe", stderr: "pipe" }
  )

  const exitCode = await keychainProcess.exited
  if (exitCode !== 0) {
    const stderrText = await new Response(keychainProcess.stderr).text()
    console.error(`✗ Failed to read credentials from keychain (exit ${exitCode}):\n  ${stderrText.trim()}`)
    process.exit(1)
  }

  const credentialsJson = (await new Response(keychainProcess.stdout).text()).trim()
  if (!credentialsJson) {
    console.error("✗ Keychain entry for 'Claude Code-credentials' was empty.")
    process.exit(1)
  }

  // Create temp dir, copy ~/.claude into it, inject credentials
  const tempDir = await mkdtemp(join(tmpdir(), "secure-vibe-"))

  const claudeDirExists = await access(CLAUDE_DIR, constants.R_OK).then(() => true).catch(() => false)
  if (claudeDirExists) {
    await cp(CLAUDE_DIR, tempDir, { recursive: true })
  }

  await writeFile(join(tempDir, ".credentials.json"), credentialsJson, { mode: 0o600 })
  console.info("  Credentials injected into temporary directory (will be deleted after container exits).")

  return { claudeHostPath: tempDir, tempDir }
}

// ── Step 4: Image check + build ───────────────────────────────────────────────

const IMAGE_NAME = "secure-vibe"
const SCRIPT_DIR = import.meta.dir

async function ensureImage(runtime: Runtime): Promise<void> {
  const checkProcess = Bun.spawn([runtime, "images", IMAGE_NAME, "-q"], {
    stdout: "pipe",
    stderr: "pipe"
  })
  await checkProcess.exited
  const imageId = (await new Response(checkProcess.stdout).text()).trim()

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
  claudeHostPath: string
): Promise<number> {
  const containerProcess = Bun.spawn(
    [
      runtime, "run", "--rm", "-it",
      "-v", `${workDir}:/home/viber/app`,
      "-v", `${claudeHostPath}:/home/viber/.claude-host:ro`,
      IMAGE_NAME
    ],
    { stdin: "inherit", stdout: "inherit", stderr: "inherit" }
  )

  return await containerProcess.exited ?? 0
}

// ── Main ──────────────────────────────────────────────────────────────────────

let tempDir: string | null = null

async function cleanup(): Promise<void> {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true }).catch(cleanupError => {
      console.error(`  Warning: failed to delete temp directory ${tempDir}:`, cleanupError)
    })
    tempDir = null
  }
}

process.on("SIGINT", async () => {
  await cleanup()
  process.exit(130)
})

process.on("SIGTERM", async () => {
  await cleanup()
  process.exit(143)
})

console.info("── secure-vibe ──────────────────────────────────────────")

const workDir = await selectDirectory()
console.info(`  Mounting: ${workDir}`)

const runtime = await selectRuntime()

const credentials = await resolveCredentials()
tempDir = credentials.tempDir

try {
  await ensureImage(runtime)
  const exitCode = await runContainer(runtime, workDir, credentials.claudeHostPath)
  process.exit(exitCode)
} finally {
  await cleanup()
}
