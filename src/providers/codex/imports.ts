import { cp, lstat, mkdtemp, readlink, rm } from "fs/promises"
import { homedir, tmpdir } from "os"
import { isAbsolute, join, relative, resolve, sep } from "path"

const IMPORTS = {
  ".codex": new Set([
    "config.toml", "AGENTS.md", "AGENTS.override.md", "profiles", "agents",
    "rules", "prompts", "hooks", "hooks.json", "skills", "plugins"
  ]),
  ".agents": new Set(["skills"])
}
const EXCLUDED_NAMES = new Set([
  ".system", ".git", ".DS_Store", "node_modules", ".venv", "venv", "__pycache__",
  ".cache", "cache", "logs", "log", "tmp", ".tmp", "sessions", "archived_sessions",
  "shell_snapshots", "app-server-daemon", "app-server-control"
])
const RUNTIME_FILE = /\.(?:sock|socket|lock|pid|log|db|sqlite\d*)(?:-(?:wal|shm|journal))?$|\.pyc$|^(?:history|session_index)\.jsonl$/

async function copyImport(source: string, target: string, allowed: Set<string>): Promise<void> {
  await cp(source, target, {
    recursive: true,
    verbatimSymlinks: true,
    filter: async path => {
      const parts = relative(source, path).split(sep).filter(Boolean)
      const isProfile = allowed.has("config.toml") && parts[0]?.endsWith(".config.toml")
      if(parts[0] && !allowed.has(parts[0]) && !isProfile) return false
      if(parts[0] === "plugins" && parts[1] && !["cache", "marketplaces"].includes(parts[1])) return false
      const names = parts[0] === "plugins" ? parts.slice(2) : parts
      if(names.some(name => EXCLUDED_NAMES.has(name) || RUNTIME_FILE.test(name))) return false
      const metadata = await lstat(path).catch(error => {
        if(error.code === "ENOENT") return null
        throw error
      })
      if(!metadata) return false
      if(metadata.isSymbolicLink()) {
        const link = await readlink(path)
        const destination = relative(source, resolve(path, "..", link))
        if(isAbsolute(link) || destination === ".." || destination.startsWith(`..${sep}`)) {
          console.warn(`  [codex] Skipping host symlink: ${path}`)
          return false
        }
        return true
      }
      return metadata.isDirectory() || metadata.isFile()
    }
  })
}

export async function withCodexImports<T>(run: (directory: string) => Promise<T>, home = homedir()): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "secure-vibe-codex-"))
  try {
    for(const [name, allowed] of Object.entries(IMPORTS)) {
      await copyImport(join(home, name), join(directory, name), allowed)
    }
    return await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
