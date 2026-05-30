import { mkdir } from "fs/promises"
import { dirname } from "path"
import { $ } from "bun"
import { PROJECT_DIR } from "../constants"
import type { Runtime, ProviderSpec } from "../types"

/**
 * Builds `spec.imageName` from `spec.dockerfilePath`.
 */
async function buildImage(runtime: Runtime, spec: ProviderSpec, noCache: boolean): Promise<void> {
  const buildArgs = [
    runtime, "build",
    "-f", spec.dockerfilePath,
    "-t", spec.imageName
  ]
  if(noCache) buildArgs.push("--no-cache")
  buildArgs.push(PROJECT_DIR)

  const buildProcess = Bun.spawn(buildArgs, { stdin: "inherit", stdout: "inherit", stderr: "inherit" })

  const buildExit = await buildProcess.exited
  if(buildExit !== 0) {
    console.error(`✗ Image build failed (exit ${buildExit}).`)
    process.exit(buildExit ?? 1)
  }

  console.info(`  Image "${spec.imageName}" built successfully.`)
}

/** Pulls `spec.imageName` from its registry. Returns true on success. */
async function pullImage(runtime: Runtime, spec: ProviderSpec): Promise<boolean> {
  const pullProcess = Bun.spawn([runtime, "pull", spec.imageName], { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
  const pullExit = await pullProcess.exited
  return pullExit === 0
}

/** Local registry digest (sha256:…) of `image` from its RepoDigests, or null if absent. */
async function getLocalDigest(runtime: Runtime, image: string): Promise<string | null> {
  const { stdout, exitCode } = await $`${runtime} image inspect ${image} --format ${"{{index .RepoDigests 0}}"}`.quiet().nothrow()
  if(exitCode !== 0) return null
  // Format is `name@sha256:…` — keep the digest part only.
  const digest = stdout.toString().trim().split("@").at(-1) ?? ""
  return digest.startsWith("sha256:") ? digest : null
}

/**
 * Remote index digest (sha256:…) of `image` without pulling layers.
 * Uses `docker buildx imagetools inspect`; returns null on any failure or on
 * runtimes without buildx (e.g. podman), so callers fall back to a plain pull.
 */
async function getRemoteDigest(runtime: Runtime, image: string): Promise<string | null> {
  if(runtime !== "docker") return null
  const { stdout, exitCode } = await $`${runtime} buildx imagetools inspect ${image} --format ${"{{.Manifest.Digest}}"}`.quiet().nothrow()
  if(exitCode !== 0) return null
  const digest = stdout.toString().trim()
  return digest.startsWith("sha256:") ? digest : null
}

/**
 * Once a day, attempts a pull and reports whether the image actually changed.
 * Cache file lives at `spec.imageCheckCachePath`. Best-effort — failures are warnings.
 */
async function checkForUpdates(runtime: Runtime, spec: ProviderSpec): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  const cacheFile = Bun.file(spec.imageCheckCachePath)

  if(await cacheFile.exists()) {
    const lastCheck = (await cacheFile.text()).trim()
    if(lastCheck === today) {
      console.info(`  Image is up to date (already checked today).`)
      return
    }
  }

  console.info(`  Checking for image updates…`)

  // Cheap path: compare the remote index digest against the local one without
  // pulling layers. If they match, the local image is current — skip the pull
  // entirely (fixes re-pulling an unchanged `latest` on every daily check).
  const [remoteDigest, localDigest] = await Promise.all([
    getRemoteDigest(runtime, spec.imageName),
    getLocalDigest(runtime, spec.imageName)
  ])
  if(remoteDigest && localDigest && remoteDigest === localDigest) {
    console.info(`  Image is already up to date.`)
    await mkdir(dirname(spec.imageCheckCachePath), { recursive: true })
    await Bun.write(spec.imageCheckCachePath, today)
    return
  }

  const idBefore = (await $`${runtime} images ${spec.imageName} -q`.text()).trim()
  const pulled = await pullImage(runtime, spec)

  if(!pulled) {
    console.warn(`  Could not reach registry to check for updates. Will retry tomorrow.`)
    await mkdir(dirname(spec.imageCheckCachePath), { recursive: true })
    await Bun.write(spec.imageCheckCachePath, today)
    return
  }

  const idAfter = (await $`${runtime} images ${spec.imageName} -q`.text()).trim()
  if(idBefore !== idAfter) {
    console.info(`  Image updated.`)
  } else {
    console.info(`  Image is already up to date.`)
  }

  await mkdir(dirname(spec.imageCheckCachePath), { recursive: true })
  await Bun.write(spec.imageCheckCachePath, today)
}

/**
 * Ensures `spec.imageName` is available locally. Honors --build / --build-no-cache / --pull.
 * Without flags: inspects locally; if found, daily-checks for updates; if missing, pulls;
 * if pull fails, falls back to a Dockerfile build.
 */
export async function ensureImage(
  runtime: Runtime,
  spec: ProviderSpec,
  build = false,
  buildNoCache = false,
  pull = false
): Promise<void> {
  if(build || buildNoCache) {
    if(!(await Bun.file(spec.dockerfilePath).exists())) {
      console.error(`✗ --build is only available when running from the project source directory. Dockerfile not found at: ${spec.dockerfilePath}`)
      process.exit(1)
    }
    console.info(`  ${buildNoCache ? "Rebuilding image (no cache)" : "Rebuilding image"} "${spec.imageName}"…`)
    await buildImage(runtime, spec, buildNoCache)
    return
  }

  if(pull) {
    console.info(`  Pulling latest image "${spec.imageName}"…`)
    const pulled = await pullImage(runtime, spec)
    if(!pulled) {
      console.error(`✗ Image pull failed.`)
      process.exit(1)
    }
    console.info(`  Image "${spec.imageName}" is up to date.`)
    return
  }

  const { exitCode } = await $`${runtime} image inspect ${spec.imageName}`.quiet().nothrow()
  const imageFound = exitCode === 0

  if(imageFound) {
    await checkForUpdates(runtime, spec)
    return
  }

  console.info(`  Image not found locally. Pulling "${spec.imageName}"…`)
  const pulled = await pullImage(runtime, spec)
  if(pulled) return

  console.info(`  Pull failed. Building from Dockerfile…`)
  if(!(await Bun.file(spec.dockerfilePath).exists())) {
    console.error(`✗ No Dockerfile found at ${spec.dockerfilePath} and pull failed. Cannot start.`)
    process.exit(1)
  }

  await buildImage(runtime, spec, false)
}
