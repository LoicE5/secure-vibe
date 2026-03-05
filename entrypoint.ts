import { mkdir, cp, access, writeFile, chmod } from "fs/promises"

const CLAUDE_DIR = "/home/viber/.claude"
const CLAUDE_HOST_DIR = "/home/viber/.claude-host"
const START_SCRIPT = "/home/viber/start-claude.sh"

// Copy host .claude config into the container's own writable filesystem.
// /home/viber/.claude is NOT bind-mounted, so nothing here touches the host.
await mkdir(CLAUDE_DIR, { recursive: true })

const hostDirExists = await access(CLAUDE_HOST_DIR).then(() => true).catch(() => false)
if (hostDirExists) {
  await cp(CLAUDE_HOST_DIR, CLAUDE_DIR, { recursive: true })
}

// Write the shell init file that auto-starts claude then drops to bash.
await writeFile(
  START_SCRIPT,
  [
    "#!/bin/bash",
    "source ~/.bashrc 2>/dev/null || true",
    "claude --dangerously-skip-permissions",
    'echo ""',
    'echo "Claude exited. Type \'claude\' to restart."'
  ].join("\n") + "\n"
)
await chmod(START_SCRIPT, 0o755)

// Replace this process with bash, using start-claude.sh as the init file.
// The user lands in claude immediately; ctrl+c / /exit drops them to bash.
const proc = Bun.spawn(["bash", "--init-file", START_SCRIPT], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit"
})

process.exit(await proc.exited)
