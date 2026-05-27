import { CLAUDE_DIR, CLAUDE_IMAGE_NAME } from "./constants"
import type { Runtime, GitIdentity } from "./types"

// ── Step 5: Run container ─────────────────────────────────────────────────────

/**
 * Runs the Claude container: mounts the workdir + a read-only ~/.claude, injects
 * CLAUDE_CREDENTIALS and the host git identity, and spawns the runtime command.
 * Returns the container's exit code. Phase 6 splits this into a generic
 * spawnContainer + a thin Claude wrapper.
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
