import { afterEach, expect, spyOn, test } from "bun:test"
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { dirname, join } from "path"
import { withCodexImports } from "./imports"
import { prepareCodexHome } from "../../entrypoints/codex-config"

const directories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "codex-import-test-"))
  directories.push(directory)
  return directory
}

async function fixture(home: string, name: string, content = name): Promise<void> {
  const path = join(home, name)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

afterEach(async () => {
  for(const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

test("imports configuration, user skills and plugin sources without runtime state", async () => {
  const home = await temporaryDirectory()
  const allowed = [
    ".codex/config.toml", ".codex/AGENTS.md", ".codex/AGENTS.override.md",
    ".codex/review.config.toml", ".codex/profiles/review.toml",
    ".codex/agents/reviewer.toml", ".codex/rules/default.rules",
    ".codex/prompts/review.md", ".codex/hooks/start.sh", ".codex/hooks.json",
    ".codex/skills/custom/SKILL.md", ".agents/skills/shared/SKILL.md",
    ".codex/plugins/cache/local/portable/1.0/.codex-plugin/plugin.json",
    ".codex/plugins/cache/local/portable/1.0/skills/review/SKILL.md",
    ".codex/plugins/cache/local/portable/1.0/scripts/check.sh",
    ".codex/plugins/cache/local/portable/1.0/resources/guide.md",
    ".codex/plugins/marketplaces/local/.agents/plugins/marketplace.json"
  ]
  const excluded = [
    ".codex/auth.json", ".codex/history.jsonl", ".codex/session_index.jsonl",
    ".codex/sessions/conversation.jsonl", ".codex/archived_sessions/conversation.jsonl",
    ".codex/state_5.sqlite", ".codex/state_5.sqlite-wal", ".codex/logs_2.sqlite-shm",
    ".codex/shell_snapshots/snapshot.sh", ".codex/app-server-daemon/codex",
    ".codex/app-server-control/daemon.sock", ".codex/thread-writer-locks/thread.lock",
    ".codex/cache/data", ".codex/packages/codex", ".codex/log/output.log",
    ".codex/skills/.system/generated/SKILL.md", ".agents/skills/.system/generated/SKILL.md",
    ".codex/plugins/.plugin-appserver/codex", ".codex/plugins/.remote-plugin-install-staging/temp",
    ".codex/plugins/cache/local/portable/1.0/node_modules/dependency/index.js",
    ".codex/plugins/cache/local/portable/1.0/.venv/bin/python",
    ".codex/plugins/cache/local/portable/1.0/__pycache__/script.pyc",
    ".codex/plugins/cache/local/portable/1.0/.cache/generated",
    ".codex/plugins/cache/local/portable/1.0/.git/config",
    ".codex/plugins/cache/local/portable/1.0/daemon.sock",
    ".codex/plugins/cache/local/portable/1.0/runtime.lock",
    ".codex/plugins/cache/local/portable/1.0/daemon.log",
    ".codex/plugins/cache/local/portable/1.0/state.db",
    ".codex/plugins/cache/local/portable/1.0/logs/output.log"
  ]
  for(const name of [...allowed, ...excluded]) await fixture(home, name)
  await chmod(join(home, ".codex/hooks/start.sh"), 0o755)
  let imported = ""
  expect(await withCodexImports(async directory => {
    imported = directory
    for(const name of allowed) expect(await readFile(join(directory, name), "utf-8")).toBe(name)
    for(const name of excluded) expect(await lstat(join(directory, name)).catch(() => null)).toBeNull()
    expect((await stat(join(directory, ".codex/hooks/start.sh"))).mode & 0o777).toBe(0o755)
    await writeFile(join(directory, ".codex/config.toml"), "container config")
    return 42
  }, home)).toBe(42)
  expect(await stat(imported).catch(() => null)).toBeNull()
  for(const name of [...allowed, ...excluded]) expect(await readFile(join(home, name), "utf-8")).toBe(name)
})

test("keeps relative resource symlinks and warns when skipping host symlinks", async () => {
  const home = await temporaryDirectory()
  await fixture(home, ".codex/skills/custom/SKILL.md", "instructions")
  const skills = join(home, ".codex/skills")
  await symlink("custom", join(skills, "relative"))
  await symlink(join(skills, "custom"), join(skills, "absolute"))
  await symlink("../../private", join(skills, "outside"))
  await fixture(home, "private/skills/SKILL.md", "private")
  await symlink(join(home, "private"), join(home, ".agents"))
  const warning = spyOn(console, "warn").mockImplementation(() => {})
  try {
    await withCodexImports(async directory => {
      expect(await readlink(join(directory, ".codex/skills/relative"))).toBe("custom")
      expect(await readFile(join(directory, ".codex/skills/relative/SKILL.md"), "utf-8")).toBe("instructions")
      for(const name of ["absolute", "outside"]) {
        expect(await lstat(join(directory, ".codex/skills", name)).catch(() => null)).toBeNull()
      }
      expect(await lstat(join(directory, ".agents")).catch(() => null)).toBeNull()
      expect(warning).toHaveBeenCalledTimes(3)
    }, home)
  } finally {
    warning.mockRestore()
  }
  expect(await readlink(join(skills, "absolute"))).toBe(join(skills, "custom"))
})

test("cleans up imports when launching throws or returns a failure", async () => {
  const home = await temporaryDirectory()
  await fixture(home, ".codex/config.toml")
  let imported = ""
  await expect(withCodexImports(async directory => {
    imported = directory
    throw new Error("launch failed")
  }, home)).rejects.toThrow("launch failed")
  expect(await stat(imported).catch(() => null)).toBeNull()
  expect(await withCodexImports(async directory => {
    imported = directory
    return 125
  }, home)).toBe(125)
  expect(await stat(imported).catch(() => null)).toBeNull()
})

test("missing host configuration leaves an empty import directory", async () => {
  const home = await temporaryDirectory()
  await withCodexImports(async directory => {
    expect(await stat(join(directory, ".codex")).catch(() => null)).toBeNull()
    expect(await stat(join(directory, ".agents")).catch(() => null)).toBeNull()
  }, home)
})

test("copies into a writable container home and injects private credentials separately", async () => {
  const home = await temporaryDirectory()
  const container = await temporaryDirectory()
  await fixture(home, ".codex/config.toml", '[profiles.review]\nmodel = "example"\n')
  await fixture(home, ".codex/auth.json", "host credentials")
  await fixture(home, ".agents/skills/shared/SKILL.md", "instructions")
  const credentials = '{"OPENAI_API_KEY":"synthetic"}'
  await withCodexImports(async directory => {
    await prepareCodexHome(directory, container, credentials)
  }, home)
  const auth = join(container, ".codex/auth.json")
  expect(await readFile(auth, "utf-8")).toBe(credentials)
  expect((await stat(auth)).mode & 0o777).toBe(0o600)
  expect(await readFile(join(container, ".agents/skills/shared/SKILL.md"), "utf-8")).toBe("instructions")
  await writeFile(join(container, ".codex/config.toml"), "changed")
  await writeFile(auth, "refreshed credentials")
  expect(await readFile(join(home, ".codex/config.toml"), "utf-8")).toContain("[profiles.review]")
  expect(await readFile(join(home, ".codex/auth.json"), "utf-8")).toBe("host credentials")
})
