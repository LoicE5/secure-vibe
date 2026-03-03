import { mkdir, cp, access, rm, writeFile } from "fs/promises";

const CLAUDE_DIR = "/home/viber/.claude";
const CLAUDE_HOST_DIR = "/home/viber/.claude-host";

// Copy host .claude config into the container's own writable filesystem.
// /home/viber/.claude is NOT bind-mounted, so nothing here touches the Mac.
await mkdir(CLAUDE_DIR, { recursive: true });

const hostDirExists = await access(CLAUDE_HOST_DIR).then(() => true).catch(() => false);
if (hostDirExists) {
  await cp(CLAUDE_HOST_DIR, CLAUDE_DIR, { recursive: true });
}

// Inject credentials from Keychain (via env var) — never written to host disk.
const credentials = process.env.CLAUDE_CREDENTIALS;
if (credentials) {
  const credPath = `${CLAUDE_DIR}/.credentials.json`;
  await rm(credPath, { recursive: true, force: true });
  await writeFile(credPath, credentials);
}

const proc = Bun.spawn(["claude", "--dangerously-skip-permissions"], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

process.exit(await proc.exited);
