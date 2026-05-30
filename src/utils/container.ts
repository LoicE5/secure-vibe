import type { Runtime, ProviderSpec, GitIdentity } from "../types"

/** One extra bind mount: [hostPath, containerPath, optional "ro"|"rw" mode]. */
export type ExtraMount = readonly [host: string, container: string, mode?: "ro" | "rw"]

/** Options for spawnContainer — provider-agnostic. */
export interface SpawnContainerOptions {
  runtime: Runtime
  spec: ProviderSpec
  workDir: string
  gitConfig: GitIdentity | null
  command: string | null
  extraEnv?: Record<string, string>
  extraMounts?: ReadonlyArray<ExtraMount>
}

/**
 * Spawns the provider container with the shared scaffolding every CLI needs:
 * workdir mount, brew volume, host git identity. The caller layers on
 * provider-specific env vars (e.g. CLAUDE_CREDENTIALS) and bind mounts.
 * Returns the container's exit code.
 */
export async function spawnContainer(options: SpawnContainerOptions): Promise<number> {
  const { runtime, spec, workDir, gitConfig, command, extraEnv = {}, extraMounts = [] } = options

  const args: string[] = [
    runtime, "run", "--rm", "-it",
    // Fixed, recognizable container name. The pid suffix is the minimal uniquifier
    // so multiple secure-vibe instances can run concurrently without a name clash
    // (the name frees on exit thanks to --rm).
    "--name", `secure-vibe-${spec.id}-${process.pid}`,
    "-v", `${workDir}:/home/viber/app`,
    // Named volume for Homebrew — seeded on first run from /opt/linuxbrew-seed in
    // the image, then persists across container restarts.
    // To reset after a rebuild: docker volume rm <brewVolumeName>
    "-v", `${spec.brewVolumeName}:/home/linuxbrew`
  ]

  for(const [host, container, mode] of extraMounts) {
    args.push("-v", mode ? `${host}:${container}:${mode}` : `${host}:${container}`)
  }

  if(gitConfig) {
    args.push("-e", `GIT_USER_NAME=${gitConfig.name}`)
    args.push("-e", `GIT_USER_EMAIL=${gitConfig.email}`)
  }

  for(const [key, value] of Object.entries(extraEnv)) {
    args.push("-e", `${key}=${value}`)
  }

  args.push(spec.imageName)

  if(command !== null) {
    // Wrap in bash -c if the command contains shell metacharacters or whitespace.
    if(/[\s&|;<>$]/.test(command)) {
      args.push("bash", "-c", command)
    } else {
      args.push(command)
    }
  }

  const containerProcess = Bun.spawn(args, { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
  return await containerProcess.exited ?? 0
}
