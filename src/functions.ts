import { mkdir } from "fs/promises"
import { userInfo } from "os"
import { dirname } from "path"
import { $ } from "bun"
import {
  CLAUDE_DIR,
  CLAUDE_DOCKERFILE_PATH,
  CLAUDE_IMAGE_CHECK_PATH,
  CLAUDE_IMAGE_NAME,
  PROJECT_DIR
} from "./constants"
import type { Runtime, GitIdentity } from "./types"

// ── Step 4: Image check + build ───────────────────────────────────────────────

/** Builds the Claude image from CLAUDE_DOCKERFILE_PATH with the host user's UID/GID. */
async function buildImage(runtime: Runtime, noCache: boolean): Promise<void> {
  const { uid, gid } = userInfo()

  const buildArgs = [
    runtime, "build",
    "-f", CLAUDE_DOCKERFILE_PATH,
    "--build-arg", `UID=${uid}`,
    "--build-arg", `GID=${gid}`,
    "-t", CLAUDE_IMAGE_NAME
  ]
  if(noCache) buildArgs.push("--no-cache")
  buildArgs.push(PROJECT_DIR)

  const buildProcess = Bun.spawn(buildArgs, { stdin: "inherit", stdout: "inherit", stderr: "inherit" })

  const buildExit = await buildProcess.exited
  if(buildExit !== 0) {
    console.error(`✗ Image build failed (exit ${buildExit}).`)
    process.exit(buildExit ?? 1)
  }

  console.info(`  Image "${CLAUDE_IMAGE_NAME}" built successfully.`)
}

/** Pulls the latest CLAUDE_IMAGE_NAME from its registry. Returns true on success. */
async function pullImage(runtime: Runtime): Promise<boolean> {
  const pullProcess = Bun.spawn([runtime, "pull", CLAUDE_IMAGE_NAME], { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
  const pullExit = await pullProcess.exited
  return pullExit === 0
}

/** Once a day, attempts to pull and reports whether the image changed. Best-effort. */
async function checkForUpdates(runtime: Runtime): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  const cacheFile = Bun.file(CLAUDE_IMAGE_CHECK_PATH)

  if(await cacheFile.exists()) {
    const lastCheck = (await cacheFile.text()).trim()
    if(lastCheck === today) {
      console.info(`  Image is up to date (already checked today).`)
      return
    }
  }

  console.info(`  Checking for image updates…`)
  const idBefore = (await $`${runtime} images ${CLAUDE_IMAGE_NAME} -q`.text()).trim()
  const pulled = await pullImage(runtime)

  if(!pulled) {
    console.warn(`  Could not reach registry to check for updates. Will retry tomorrow.`)
    await mkdir(dirname(CLAUDE_IMAGE_CHECK_PATH), { recursive: true })
    await Bun.write(CLAUDE_IMAGE_CHECK_PATH, today)
    return
  }

  const idAfter = (await $`${runtime} images ${CLAUDE_IMAGE_NAME} -q`.text()).trim()
  if(idBefore !== idAfter) {
    console.info(`  Image updated.`)
  } else {
    console.info(`  Image is already up to date.`)
  }

  await mkdir(dirname(CLAUDE_IMAGE_CHECK_PATH), { recursive: true })
  await Bun.write(CLAUDE_IMAGE_CHECK_PATH, today)
}

/** Ensures the Claude image is available locally — respects --build / --build-no-cache / --pull flags. */
export async function ensureImage(runtime: Runtime, build = false, buildNoCache = false, pull = false): Promise<void> {
  if(build || buildNoCache) {
    if(!(await Bun.file(CLAUDE_DOCKERFILE_PATH).exists())) {
      console.error(`✗ --build is only available when running from the project source directory. Dockerfile not found at: ${CLAUDE_DOCKERFILE_PATH}`)
      process.exit(1)
    }
    console.info(`  ${buildNoCache ? "Rebuilding image (no cache)" : "Rebuilding image"} "${CLAUDE_IMAGE_NAME}"…`)
    await buildImage(runtime, buildNoCache)
    return
  }

  if(pull) {
    console.info(`  Pulling latest image "${CLAUDE_IMAGE_NAME}"…`)
    const pulled = await pullImage(runtime)
    if(!pulled) {
      console.error(`✗ Image pull failed.`)
      process.exit(1)
    }
    console.info(`  Image "${CLAUDE_IMAGE_NAME}" is up to date.`)
    return
  }

  const { exitCode } = await $`${runtime} image inspect ${CLAUDE_IMAGE_NAME}`.quiet().nothrow()
  const imageFound = exitCode === 0

  if(imageFound) {
    await checkForUpdates(runtime)
    return
  }

  console.info(`  Image not found locally. Pulling "${CLAUDE_IMAGE_NAME}"…`)
  const pulled = await pullImage(runtime)
  if(pulled) return

  console.info(`  Pull failed. Building from Dockerfile…`)
  if(!(await Bun.file(CLAUDE_DOCKERFILE_PATH).exists())) {
    console.error(`✗ No Dockerfile found at ${CLAUDE_DOCKERFILE_PATH} and pull failed. Cannot start.`)
    process.exit(1)
  }

  await buildImage(runtime, false)
}

// ── Step 5: Run container ─────────────────────────────────────────────────────

/**
 * Runs the Claude container: mounts the workdir + a read-only ~/.claude, injects
 * CLAUDE_CREDENTIALS and the host git identity, and spawns the runtime command.
 * Returns the container's exit code.
 */
export async function runContainer(
  runtime: Runtime,
  workDir: string,
  credentialsJson: string | null,
  command: string | null = null,
  gitConfig: GitIdentity | null = null
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

  if(gitConfig) {
    args.push("-e", `GIT_USER_NAME=${gitConfig.name}`)
    args.push("-e", `GIT_USER_EMAIL=${gitConfig.email}`)
  }

  args.push(CLAUDE_IMAGE_NAME)

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
