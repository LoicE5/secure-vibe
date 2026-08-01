import { DIND_LABEL } from "../constants"
import { resolveDindDataRoot } from "./dind"
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
  /** Extra `docker run` flags (e.g. `--add-host=…`) injected just before the image name. */
  extraArgs?: ReadonlyArray<string>
}

/** Spawns the provider container with the shared workdir mount, brew volume and git identity. */
export async function spawnContainer(options: SpawnContainerOptions): Promise<number> {
  const { runtime, spec, workDir, gitConfig, command, extraEnv = {}, extraMounts = [], extraArgs = [] } = options

  const args: string[] = [
    runtime, "run", "--rm", "-it",
    "--name", `secure-vibe-${spec.id}${spec.dind ? "-dind" : ""}-${process.pid}`,
    "-v", `${workDir}:/home/viber/app`,
    "-v", `${spec.brewVolumeName}:/home/linuxbrew`
  ]

  if(spec.dind) {
    // --privileged is what rootlesskit needs: the default seccomp profile blocks
    // clone(CLONE_NEWUSER), the default AppArmor profile denies its mounts, and /dev/net/tun
    // is absent from a stock container's /dev. The daemon itself still runs as viber.
    args.push("--privileged", "--label", DIND_LABEL)
    // A volume, not the container's rootfs: overlayfs refuses an upperdir that is itself on
    // overlayfs, so an unmounted data root silently degrades to the unusable vfs driver.
    args.push("-v", await resolveDindDataRoot(runtime))
  }

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

  // Must attach to `docker run`, before the image name, not the command that follows it.
  args.push(...extraArgs)

  args.push(spec.imageName)

  if(command !== null) {
    if(/[\s&|;<>$]/.test(command)) {
      args.push("bash", "-c", command)
    } else {
      args.push(command)
    }
  }

  const containerProcess = Bun.spawn(args, { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
  return await containerProcess.exited ?? 0
}
