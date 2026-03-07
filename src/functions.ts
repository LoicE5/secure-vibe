import { access, constants, readFile, rename, mkdir } from "fs/promises"
import { createInterface } from "readline"
import { userInfo } from "os"
import { resolve, join, dirname, basename } from "path"
import { $ } from "bun"
import { BANNED_DIRS, CLAUDE_DIR, CLAUDE_JSON_PATH, DOCKERFILE_PATH, IMAGE_NAME, PROJECT_DIR, VALID_SAVE_MODES } from "./constants"
import type { Runtime, SaveMode } from "./interfaces"

// ── Args ──────────────────────────────────────────────────────────────────────

export function parseArgs(): {
  directory: string | null
  save: string | null
  runtime: string | null
  command: string | null
  exclude: string | null
  build: boolean
  buildNoCache: boolean
} {
  const argv = process.argv.slice(2)
  const positionals: string[] = []
  let save: string | null = null
  let runtime: string | null = null
  let command: string | null = null
  let exclude: string | null = null
  let build = false
  let buildNoCache = false

  const consumed = new Set<number>()
  for(const [index, arg] of argv.entries()) {
    if(consumed.has(index)) continue
    if(arg === "--build-no-cache") {
      buildNoCache = true
    } else if(arg === "--build") {
      build = true
    } else if(arg.startsWith("--runtime=")) {
      runtime = arg.slice("--runtime=".length)
    } else if(arg === "--runtime" && index + 1 < argv.length) {
      runtime = argv.at(index + 1)!; consumed.add(index + 1)
    } else if(arg.startsWith("--save=")) {
      save = arg.slice("--save=".length)
    } else if(arg === "--save" && index + 1 < argv.length) {
      save = argv.at(index + 1)!; consumed.add(index + 1)
    } else if(arg.startsWith("--command=")) {
      command = arg.slice("--command=".length)
    } else if(arg === "--command" && index + 1 < argv.length) {
      command = argv.at(index + 1)!; consumed.add(index + 1)
    } else if(arg.startsWith("--exclude=")) {
      exclude = arg.slice("--exclude=".length)
    } else if(arg === "--exclude" && index + 1 < argv.length) {
      exclude = argv.at(index + 1)!; consumed.add(index + 1)
    } else if(!arg.startsWith("-")) {
      positionals.push(arg)
    }
    // Unknown flags are ignored
  }

  return {
    directory: positionals.at(0) ?? null,
    save,
    runtime,
    command: command ?? (positionals.slice(1).join(" ") || null),
    exclude,
    build,
    buildNoCache,
  }
}

// ── Env helpers ───────────────────────────────────────────────────────────────

// Returns null if the env var is unset or explicitly set to "prompt".
export function getEnvConfig(key: string): string | null {
  const val = process.env[key]
  if(!val || val.toLowerCase() === "prompt") return null
  return val
}

// Returns true if the env var is set to "true", "1", or "yes" (case-insensitive).
export function getBoolEnv(key: string): boolean {
  return ["true", "1", "yes"].includes(process.env[key]?.toLowerCase() ?? "")
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    const stat = await Bun.file(path).stat()
    return stat.isDirectory()
  } catch {
    return false
  }
}


export async function commandExists(command: string): Promise<boolean> {
  return Bun.which(command) !== null
}

export async function testRuntime(runtime: string): Promise<boolean> {
  const proc = Bun.spawn([runtime, "info"], {
    stdout: "pipe",
    stderr: "pipe"
  })
  return await proc.exited === 0
}

export function isBannedDirectory(absolutePath: string): boolean {
  return BANNED_DIRS.has(absolutePath)
}

export function timestamp() {
  return new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)
}

// ── Step 1: Directory selection ───────────────────────────────────────────────

export async function selectDirectory(preValue: string | null): Promise<string> {
  if(preValue !== null) {
    const targetPath = preValue === "." || preValue === "" ? process.cwd() : resolve(preValue)
    if(!(await isDirectory(targetPath))) {
      console.error(`  ✗ Not a valid directory: ${targetPath}`)
      process.exit(1)
    }
    if(isBannedDirectory(targetPath)) {
      console.error(`  ✗ Mounting "${targetPath}" is not allowed for security reasons.`)
      process.exit(1)
    }
    return targetPath
  }

  while(true) {
    const input = await prompt("Directory to mount (leave blank for current directory): ")
    const targetPath = input === "" ? process.cwd() : resolve(input)

    if(!(await isDirectory(targetPath))) {
      console.error(`  ✗ Not a valid directory: ${targetPath}`)
      continue
    }

    if(isBannedDirectory(targetPath)) {
      console.error(`  ✗ Mounting "${targetPath}" is not allowed for security reasons.`)
      continue
    }

    return targetPath
  }
}

// ── Step 2: Runtime detection ─────────────────────────────────────────────────

export async function selectRuntime(preValue: string | null): Promise<Runtime> {
  const dockerAvailable = (await commandExists("docker")) && (await testRuntime("docker"))
  const podmanAvailable = (await commandExists("podman")) && (await testRuntime("podman"))

  if(!dockerAvailable && !podmanAvailable) {
    console.error("✗ Neither docker nor podman is available or running. Please start one and try again.")
    process.exit(1)
  }

  if(dockerAvailable && !podmanAvailable) {
    if(preValue && preValue !== "docker") console.warn(`  ⚠ Runtime "${preValue}" not available, using docker.`)
    console.info("  Using docker.")
    return "docker"
  }

  if(podmanAvailable && !dockerAvailable) {
    if(preValue && preValue !== "podman") console.warn(`  ⚠ Runtime "${preValue}" not available, using podman.`)
    console.info("  Using podman.")
    return "podman"
  }

  // Both available — use preValue if valid
  if(preValue !== null) {
    const normalized = preValue.toLowerCase()
    if(normalized === "docker" || normalized === "podman") {
      console.info(`  Using ${normalized}.`)
      return normalized as Runtime
    }
    console.warn(`  ✗ Invalid runtime "${preValue}". Expected: docker, podman. Prompting…`)
  }

  // Prompt
  while(true) {
    const answer = await prompt("Both docker and podman are available. Which one to use? [docker/podman]: ")
    const normalized = answer.toLowerCase()
    if(normalized === "docker" || normalized === "podman") return normalized as Runtime
    console.error('  ✗ Please enter "docker" or "podman".')
  }
}

// ── Step 3: Credential resolution ────────────────────────────────────────────

// Reads ~/.claude.json and extracts the auth fields Claude needs.
// Claude 2.1.63+ stores credentials there (not in ~/.claude/.credentials.json).
export async function readClaudeJson(): Promise<string | null> {
  const exists = await access(CLAUDE_JSON_PATH, constants.R_OK).then(() => true).catch(() => false)
  if(!exists) return null

  try {
    const raw = await readFile(CLAUDE_JSON_PATH, "utf-8")
    const content = JSON.parse(raw) as Record<string, unknown>
    if(!content.claudeAiOauth) return null
    return raw
  } catch(readError: unknown) {
    console.warn("  Could not parse ~/.claude.json:", readError)
    return null
  }
}

// Returns the credentials JSON string to inject into the container via env var,
// or null if credentials are already present in the mounted .claude-host dir.
export async function resolveCredentials(): Promise<string | null> {
  // Primary: read from ~/.claude.json (Claude 2.1.63+, works on all platforms)
  const fromFile = await readClaudeJson()
  if(fromFile) {
    console.info("  Credentials read from ~/.claude.json.")
    return fromFile
  }

  // macOS fallback: pull from keychain (older Claude or fresh install)
  if(process.platform === "darwin") {
    console.info("  ~/.claude.json not found. Trying macOS keychain…")
    try {
      const serviceName = "Claude Code-credentials"
      const credentialsJson = (await $`security find-generic-password -s ${serviceName} -w`.text()).trim()
      if(!credentialsJson) {
        console.error("✗ Keychain entry for 'Claude Code-credentials' was empty.")
        process.exit(1)
      }
      console.info("  Credentials extracted from keychain.")
      return credentialsJson
    } catch(keychainError: unknown) {
      console.error("✗ Failed to read credentials from keychain:", keychainError)
      process.exit(1)
    }
  }

  // Linux: check old .credentials.json location as last resort
  const legacyFile = join(CLAUDE_DIR, ".credentials.json")
  const legacyExists = await access(legacyFile, constants.R_OK).then(() => true).catch(() => false)
  if(legacyExists) {
    const content = await readFile(legacyFile, "utf-8")
    console.info("  Credentials read from ~/.claude/.credentials.json.")
    return content
  }

  console.error("✗ No credentials found. Please authenticate with Claude Code on this machine first.")
  process.exit(1)
}

// ── Step 4: Image check + build ───────────────────────────────────────────────

export async function ensureImage(runtime: Runtime, build = false, buildNoCache = false): Promise<void> {
  if(!build && !buildNoCache) {
    const imageId = (await $`${runtime} images ${IMAGE_NAME} -q`.text()).trim()
    if(imageId !== "") {
      console.info(`  Image "${IMAGE_NAME}" found.`)
      return
    }
    console.info(`  Image "${IMAGE_NAME}" not found. Building…`)
  } else {
    console.info(`  ${buildNoCache ? "Rebuilding image (no cache)" : "Rebuilding image"} "${IMAGE_NAME}"…`)
  }

  const { uid, gid } = userInfo()

  const buildArgs = [
    runtime, "build",
    "-f", DOCKERFILE_PATH,
    "--build-arg", `UID=${uid}`,
    "--build-arg", `GID=${gid}`,
    "-t", IMAGE_NAME,
  ]
  if(buildNoCache) buildArgs.push("--no-cache")
  buildArgs.push(PROJECT_DIR)

  const buildProcess = Bun.spawn(buildArgs, { stdin: "inherit", stdout: "inherit", stderr: "inherit" })

  const buildExit = await buildProcess.exited
  if(buildExit !== 0) {
    console.error(`✗ Image build failed (exit ${buildExit}).`)
    process.exit(buildExit ?? 1)
  }

  console.info(`  Image "${IMAGE_NAME}" built successfully.`)
}

// ── Step 5: Run container ─────────────────────────────────────────────────────

export async function runContainer(
  runtime: Runtime,
  workDir: string,
  credentialsJson: string | null,
  command: string | null = null
): Promise<number> {
  const args = [
    runtime, "run", "--rm", "-it",
    "-v", `${workDir}:/home/viber/app`,
    // Mount as read-only so the container never writes back to the host's ~/.claude.
    // The entrypoint copies it to a writable location inside the container.
    "-v", `${CLAUDE_DIR}:/home/viber/.claude-host:ro`,
    // Named volume for Homebrew — seeded from /opt/linuxbrew-seed on first run,
    // then persists across container restarts.
    // To reset after an image rebuild: docker volume rm secure-vibe-brew
    "-v", "secure-vibe-brew:/home/linuxbrew"
  ]

  if(credentialsJson) {
    // Pass credentials as an env var; entrypoint writes them to .credentials.json
    // inside the container. Nothing is ever written to the host's ~/.claude.
    args.push("-e", `CLAUDE_CREDENTIALS=${credentialsJson}`)
  }

  args.push(IMAGE_NAME)

  if(command !== null) {
    // Wrap in bash -c if the command contains shell metacharacters or spaces
    if(/[\s&|;<>$]/.test(command)) {
      args.push("bash", "-c", command)
    } else {
      args.push(command)
    }
  }

  const containerProcess = Bun.spawn(args, { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
  return await containerProcess.exited ?? 0
}

// ── Step 6: Save options ──────────────────────────────────────────────────────

export async function selectSaveOption(workDir: string, preValue: string | null): Promise<SaveMode> {
  if(preValue !== null) {
    const normalized = preValue.toLowerCase() as SaveMode
    if(VALID_SAVE_MODES.includes(normalized)) {
      if(normalized !== "no") console.info(`  Save mode: ${normalized}`)
      return normalized
    }
    console.warn(`  ✗ Invalid save value "${preValue}". Expected: zip, copy, no.`)
  }

  const parent = dirname(workDir)
  const name = basename(workDir)
  console.info(`\nYou can save your current directory if you need to.`)
  console.info(`  Tip: recommended for projects that do not yet have a remote git repository.`)

  while(true) {
    const answer = await prompt(`  Save "${name}" to ${parent}/ as [zip/copy/skip]: `)
    const normalized = answer.toLowerCase()
    if(normalized === "zip" || normalized === "copy") return normalized as SaveMode
    if(normalized === "skip" || normalized === "no" || normalized === "") return "no"
    console.error('  ✗ Please enter "zip", "copy", or "skip".')
  }
}

export async function runScrolling(args: string[], opts: { cwd?: string; windowSize?: number } = {}): Promise<number> {
  const { cwd, windowSize = 5 } = opts

  if(!process.stdout.isTTY) {
    const proc = Bun.spawn(args, { cwd, stdout: "inherit", stderr: "inherit" })
    return proc.exited
  }

  const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" })
  const buffer: string[] = []
  let linesWritten = 0
  const cols = process.stdout.columns ?? 80

  function emit(line: string) {
    const trimmed = line.trimEnd().slice(0, cols - 2)
    if(!trimmed) return
    buffer.push(trimmed)
    if(buffer.length > windowSize) buffer.shift()
    if(linesWritten > 0) process.stdout.write(`\x1b[${linesWritten}A`)
    process.stdout.write(buffer.map(l => `\x1b[2K  ${l}`).join("\n") + "\n")
    linesWritten = buffer.length
  }

  async function consume(stream: ReadableStream<Uint8Array>) {
    const decoder = new TextDecoder()
    let partial = ""
    for await(const chunk of stream) {
      const text = partial + decoder.decode(chunk, { stream: true })
      const parts = text.split(/[\n\r]/)
      partial = parts.pop() ?? ""
      for(const part of parts) emit(part)
    }
    if(partial) emit(partial)
  }

  await Promise.all([consume(proc.stdout), consume(proc.stderr)])
  return proc.exited
}

// ── Exclude / secrets ─────────────────────────────────────────────────────────

export function parseExcludePatterns(raw: string): string[] {
  return raw.split(",").map(pattern => pattern.trim()).filter(pattern => pattern.length > 0)
}

export async function resolveExcludedFiles(workDir: string, patterns: string[]): Promise<string[]> {
  const seen = new Set<string>()
  for(const pattern of patterns) {
    const glob = new Bun.Glob(pattern)
    for await(const relPath of glob.scan({ cwd: workDir, onlyFiles: true, dot: true })) {
      seen.add(relPath)
    }
  }
  return [...seen].sort()
}

export async function isGitIgnored(workDir: string, relPath: string): Promise<boolean> {
  const proc = Bun.spawn(["git", "check-ignore", "-q", relPath], {
    cwd: workDir,
    stdout: "pipe",
    stderr: "pipe"
  })
  return await proc.exited === 0
}

type SecretEntry = { flatName: string; originalRelPath: string }

export async function moveSecretsOut(workDir: string, relPaths: string[]): Promise<string> {
  const secretsDir = join(dirname(workDir), `${basename(workDir)}-${timestamp()}-secrets`)
  await mkdir(secretsDir, { recursive: true })

  const manifest: SecretEntry[] = []

  for(const relPath of relPaths) {
    const ignored = await isGitIgnored(workDir, relPath)
    if(!ignored) {
      console.warn(`\x1b[33m  ⚠ ${relPath} is not gitignored — moving it will affect git status\x1b[0m`)
    }

    const flatName = relPath.replaceAll("/", "__")
    await rename(join(workDir, relPath), join(secretsDir, flatName))
    manifest.push({ flatName, originalRelPath: relPath })
  }

  await Bun.write(join(secretsDir, "manifest.json"), JSON.stringify(manifest, null, 2))
  return secretsDir
}

export async function moveSecretsBack(workDir: string, secretsDir: string): Promise<void> {
  let manifest: SecretEntry[]
  try {
    manifest = JSON.parse(await readFile(join(secretsDir, "manifest.json"), "utf-8")) as SecretEntry[]
  } catch(error: unknown) {
    console.error("  ✗ Could not read secrets manifest — files were NOT restored:", error)
    return
  }

  for(const { flatName, originalRelPath } of manifest) {
    try {
      const destination = join(workDir, originalRelPath)
      await mkdir(dirname(destination), { recursive: true })
      await rename(join(secretsDir, flatName), destination)
      console.info(`  Restored: ${originalRelPath}`)
    } catch(error: unknown) {
      console.error(`  ✗ Failed to restore ${originalRelPath}:`, error)
    }
  }

  console.warn(`\x1b[33m  ⚠ Secrets directory was NOT deleted: ${secretsDir}\n  Delete it manually once you have confirmed all files are restored.\x1b[0m`)
}

export async function saveDirectory(workDir: string, mode: "zip" | "copy"): Promise<void> {
  const parent = dirname(workDir)
  const name = basename(workDir)
  const dest = mode === "zip"
    ? join(parent, `${name}-${timestamp()}.zip`)
    : join(parent, `${name}-${timestamp()}`)

  try {
    if(mode === "zip") {
      console.info(`  Zipping "${name}" to ${dest} ...`)
      const code = await runScrolling(["zip", "-r", dest, "."], { cwd: workDir })
      if(code !== 0) { console.error(`  ✗ zip failed (exit ${code}).`); return }
    } else {
      console.info(`  Copying "${name}" to ${dest} ...`)
      const code = await runScrolling(["rsync", "-avh", "--progress", workDir, dest])
      if(code !== 0) { console.error(`  ✗ rsync failed (exit ${code}).`); return }
    }

    console.info(`  Saved to: ${dest}`)
  } catch(saveError: unknown) {
    console.error("  ✗ Save failed:", saveError)
  }
}
