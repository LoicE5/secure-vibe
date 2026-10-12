import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { resolveOpenCodeConfiguration, resolveOpenCodeDirectories } from "./config"
import { referencedOpenCodeVariables, resolveOpenCodeEnvironment } from "./credentials"
import { injectOpenCodeSandbox, parseOpenCodeConfig, prepareOpenCodeFiles, remapOpenCodeConfig, type OpenCodeSetup } from "../../entrypoints/opencode-config"
import { loadDotEnv } from "../../utils/env-file"
import { Database } from "bun:sqlite"

const temporaryDirectories: string[] = []

/** Creates an isolated fixture tree. */
async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "secure-vibe-opencode-"))
  temporaryDirectories.push(directory)
  return directory
}

/** Writes a fixture with existing parents. */
async function fixture(path: string, content: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true })
  await writeFile(path, content)
}

afterEach(async () => {
  for(const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true })
})

describe("OpenCode configuration and credentials", () => {
  test("snapshots committed WAL records while keeping the source database and credentials unchanged", async () => {
    const root = await temporaryDirectory()
    const host = join(root, "host")
    const target = join(root, "container")
    await mkdir(host)
    const sourcePath = join(host, "opencode.db")
    const writer = new Database(sourcePath)
    try {
      writer.exec("CREATE TABLE migration(id TEXT); PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; PRAGMA wal_checkpoint(TRUNCATE)")
      writer.exec("CREATE TABLE session(id TEXT); INSERT INTO session VALUES ('synthetic-session')")
      const originalDatabase = await readFile(sourcePath)
      const originalWal = await readFile(`${sourcePath}-wal`)
      await fixture(join(host, "auth.json"), '{"openai":{"key":"synthetic"}}')
      await fixture(join(host, "locks/active.lock/heartbeat"), "")
      await prepareOpenCodeFiles({
        copies: [{ host, container: target, source: host, directory: true }],
        mappings: [], configFiles: [], hostHome: root, agentsPath: join(target, "AGENTS.md")
      }, "")
      for(const name of ["opencode.db-wal", "opencode.db-shm", "locks"]) expect(await stat(join(target, name)).catch(() => null)).toBeNull()
      const snapshot = new Database(join(target, "opencode.db"), { readonly: true })
      try {
        expect(snapshot.query("SELECT id FROM session").all()).toEqual([{ id: "synthetic-session" }])
      } finally {
        snapshot.close()
      }
      expect(await readFile(sourcePath)).toEqual(originalDatabase)
      expect(await readFile(`${sourcePath}-wal`)).toEqual(originalWal)
      expect(await readFile(join(target, "auth.json"), "utf-8")).toContain("synthetic")
    } finally {
      writer.close()
    }
  })

  test("preserves an incompatible session database as a private backup and lets OpenCode create a fresh database", async () => {
    const root = await temporaryDirectory()
    const host = join(root, "host")
    const target = join(root, "container")
    await mkdir(host)
    const sourcePath = join(host, "opencode.db")
    const database = new Database(sourcePath)
    database.exec("CREATE TABLE unrelated_state(id TEXT); INSERT INTO unrelated_state VALUES ('synthetic-history')")
    database.close()
    const original = await readFile(sourcePath)
    await prepareOpenCodeFiles({
      copies: [{ host, container: target, source: host, directory: true }],
      mappings: [], configFiles: [], hostHome: root, agentsPath: join(target, "AGENTS.md")
    }, "")
    expect(await stat(join(target, "opencode.db")).catch(() => null)).toBeNull()
    const backupPath = join(target, "opencode.db.secure-vibe-backup")
    const backup = new Database(backupPath, { readonly: true })
    try {
      expect(backup.query("SELECT id FROM unrelated_state").all()).toEqual([{ id: "synthetic-history" }])
    } finally {
      backup.close()
    }
    expect((await stat(backupPath)).mode & 0o777).toBe(0o600)
    expect(await readFile(sourcePath)).toEqual(original)
  })

  test("preserves unreadable session database files and sidecars without blocking startup", async () => {
    const root = await temporaryDirectory()
    const host = join(root, "host")
    const target = join(root, "container")
    await fixture(join(host, "opencode.db"), "synthetic invalid database")
    await fixture(join(host, "opencode.db-wal"), "synthetic journal")
    await prepareOpenCodeFiles({
      copies: [{ host, container: target, source: host, directory: true }],
      mappings: [], configFiles: [], hostHome: root, agentsPath: join(target, "AGENTS.md")
    }, "")
    expect(await stat(join(target, "opencode.db")).catch(() => null)).toBeNull()
    for(const suffix of ["", "-wal"]) {
      const backupPath = join(target, `opencode.db.secure-vibe-backup${suffix}`)
      expect(await readFile(backupPath)).toEqual(await readFile(join(host, `opencode.db${suffix}`)))
      expect((await stat(backupPath)).mode & 0o777).toBe(0o600)
    }
  })

  test("runner shares project, brew, Git identity and command handling while mounting provider files read-only", async () => {
    const home = await temporaryDirectory()
    const project = join(home, "project")
    const binaries = join(home, "bin")
    const captured = join(home, "arguments.json")
    await fixture(join(home, ".config/opencode/opencode.jsonc"), '{"provider":{"custom":{"env":["CUSTOM_TOKEN"]}}}')
    await fixture(join(home, ".local/share/opencode/auth.json"), '{"openai":{"type":"api","key":"saved-synthetic"}}')
    await fixture(join(project, ".env"), "CUSTOM_TOKEN=project-synthetic\nUNRELATED_SECRET=private\n")
    await fixture(join(binaries, "docker"), `#!${process.execPath}\nawait Bun.write(${JSON.stringify(captured)}, JSON.stringify(process.argv.slice(2)))\n`)
    await chmod(join(binaries, "docker"), 0o755)
    const child = Bun.spawn([process.execPath, "--no-env-file", join(import.meta.dir, "../../../test/fixtures/opencode-probe.ts"), project, "opencode run 'hello world'"], {
      env: { HOME: home, PATH: `${binaries}:${process.env.PATH}`, CUSTOM_TOKEN: "host-synthetic" },
      stdout: "pipe", stderr: "pipe"
    })
    const output = await new Response(child.stdout).text()
    const errors = await new Response(child.stderr).text()
    expect(await child.exited).toBe(0)
    expect(errors).toBe("")
    expect(output).toContain("saved credentials:")
    expect(output).not.toContain("project-synthetic")
    expect(output).not.toContain("saved-synthetic")
    const args: string[] = JSON.parse(await readFile(captured, "utf-8"))
    expect(args).toContain(`${project}:/home/viber/app`)
    expect(args).toContain("secure-vibe-brew:/home/linuxbrew")
    expect(args).toContain(`${home}/.config/opencode:/home/viber/.opencode-host/config:ro`)
    expect(args).toContain(`${home}/.local/share/opencode:/home/viber/.opencode-host/data:ro`)
    expect(args).toContain("CUSTOM_TOKEN=project-synthetic")
    expect(args.some(argument => argument.startsWith("UNRELATED_SECRET="))).toBe(false)
    expect(args).toContain("GIT_USER_NAME=Test User")
    expect(args).toContain("GIT_USER_EMAIL=test@example.invalid")
    expect(args.slice(-4)).toEqual(["ghcr.io/loice5/secure-vibe/opencode:latest", "bash", "-c", "opencode run 'hello world'"])
  })
  test("resolves default and native absolute XDG directories", () => {
    expect(resolveOpenCodeDirectories({}, "/host/home")).toEqual({
      config: "/host/home/.config/opencode",
      data: "/host/home/.local/share/opencode",
      state: "/host/home/.local/state/opencode",
      home: "/host/home/.opencode"
    })
    expect(resolveOpenCodeDirectories({ XDG_CONFIG_HOME: "/config", XDG_DATA_HOME: "/data", XDG_STATE_HOME: "/state" }, "/host/home"))
      .toEqual({ config: "/config/opencode", data: "/data/opencode", state: "/state/opencode", home: "/host/home/.opencode" })
    expect(resolveOpenCodeDirectories({ XDG_CONFIG_HOME: "relative" }, "/host/home").config).toBe("/host/home/.config/opencode")
  })

  test("missing provider directories produce no mounts and allow unauthenticated startup", async () => {
    const home = await temporaryDirectory()
    const configuration = await resolveOpenCodeConfiguration(join(home, "project"), {}, home)
    expect(configuration.mounts).toEqual([])
    const environment = await resolveOpenCodeEnvironment(configuration, {}, {})
    expect(environment.OPENCODE_DISABLE_AUTOUPDATE).toBe("1")
    expect(JSON.parse(environment.SECURE_VIBE_OPENCODE_SETUP!).copies).toEqual([])
    expect(await stat(join(home, ".config")).catch(() => null)).toBeNull()
  })

  test("custom overrides stage existing files once and translate project and copied paths", async () => {
    const home = await temporaryDirectory()
    const project = join(home, "project")
    const config = join(home, "custom config")
    const tui = join(project, "custom-tui.jsonc")
    await fixture(join(config, "opencode.jsonc"), '{"instructions":["{env:CUSTOM_INSTRUCTIONS}"]}')
    await fixture(tui, '{"theme":"opencode"}')
    const configuration = await resolveOpenCodeConfiguration(project, {
      OPENCODE_CONFIG_DIR: config,
      OPENCODE_CONFIG: join(config, "opencode.jsonc"),
      OPENCODE_TUI_CONFIG: "custom-tui.jsonc"
    }, home)
    expect(configuration.mounts).toHaveLength(2)
    expect(configuration.mounts.every(mount => mount.at(2) === "ro")).toBe(true)
    expect(configuration.environment).toEqual({
      OPENCODE_CONFIG_DIR: "/home/viber/.config/opencode-custom",
      OPENCODE_CONFIG: "/home/viber/.config/opencode-custom/opencode.jsonc",
      OPENCODE_TUI_CONFIG: "/home/viber/.config/opencode-overrides/tui.jsonc"
    })
    expect(configuration.setup.agentsPath).toBe("/home/viber/.config/opencode-custom/AGENTS.md")
    expect(configuration.configs).toContain('{"instructions":["{env:CUSTOM_INSTRUCTIONS}"]}')
    const environment = await resolveOpenCodeEnvironment(configuration, { CUSTOM_INSTRUCTIONS: join(project, "instructions.md") }, {})
    expect(environment.CUSTOM_INSTRUCTIONS).toBe("/home/viber/app/instructions.md")
  })

  test("rejects whole-home overrides including symlinks", async () => {
    const home = await temporaryDirectory()
    await expect(resolveOpenCodeConfiguration(join(home, "project"), { OPENCODE_CONFIG_DIR: home }, home)).rejects.toThrow("Refusing to mount broad")
    const alias = join(await temporaryDirectory(), "alias")
    await symlink(home, alias)
    await expect(resolveOpenCodeConfiguration(join(home, "project"), { OPENCODE_CONFIG_DIR: alias }, home)).rejects.toThrow("Refusing to mount broad")
  })

  test("inline configuration is remapped once at startup, even when host and container paths overlap", async () => {
    const home = await temporaryDirectory()
    const project = join(home, "project")
    const configuration = await resolveOpenCodeConfiguration(project, {}, home)
    configuration.setup.mappings.push({ host: "/home/viber/app", container: "/home/viber/.config/opencode-custom" })
    const inline = `// Keep inline comments.\n{"instructions":["{file:${project}/rules.md}"],"permission":{"bash":"deny"}}`
    const environment = await resolveOpenCodeEnvironment(configuration, {}, { OPENCODE_CONFIG_CONTENT: inline })
    expect(environment.OPENCODE_CONFIG_CONTENT).toBe(inline)
    const remapped = remapOpenCodeConfig(environment.OPENCODE_CONFIG_CONTENT!, configuration.setup)
    expect(remapped).toContain("/home/viber/app/rules.md")
    expect(remapped).not.toContain("/home/viber/.config/opencode-custom/rules.md")
    expect(remapped).toContain("// Keep inline comments.")
    expect(remapped).toContain('"bash":"deny"')
  })

  test("selects Models.dev variables and explicit references with dotenv precedence, excluding comments and owned variables", async () => {
    const home = await temporaryDirectory()
    const project = join(home, "project")
    const inline = '{"instructions":["{env:INLINE_KEY}"],"permission":{"bash":"deny"}}'
    await fixture(join(home, ".config/opencode/opencode.jsonc"), `{
      // {env:COMMENT_SECRET}
      "provider": { "custom": { "env": ["CUSTOM_TOKEN", "HOME", "PATH", "XDG_CONFIG_HOME", "SECURE_VIBE_OPENCODE_SETUP"] } },
      "mcp": {"example": {"environment": {"token":"{env:MCP_TOKEN}"}}}
    }`)
    await fixture(join(project, ".opencode/opencode.json"), '{"instructions":["{env:PROJECT_KEY}"]}')
    await fixture(join(project, ".env"), "OPENAI_API_KEY=project-key\nCUSTOM_TOKEN=project-token\nUNRELATED_SECRET=hidden\n")
    const configuration = await resolveOpenCodeConfiguration(project, { OPENCODE_CONFIG_CONTENT: inline }, home)
    const environment = await resolveOpenCodeEnvironment(configuration, await loadDotEnv(project), {
      OPENAI_API_KEY: "host-key", CUSTOM_TOKEN: "host-token", MCP_TOKEN: "mcp", PROJECT_KEY: "project",
      INLINE_KEY: "inline", OPENCODE_CONFIG_CONTENT: inline, OPENCODE_PERMISSION: '{"edit":"deny"}',
      COMMENT_SECRET: "hidden", UNRELATED_SECRET: "hidden", HOME: "bad", PATH: "bad", XDG_CONFIG_HOME: "bad"
    })
    expect(environment.OPENAI_API_KEY).toBe("project-key")
    expect(environment.CUSTOM_TOKEN).toBe("project-token")
    expect(environment.MCP_TOKEN).toBe("mcp")
    expect(environment.PROJECT_KEY).toBe("project")
    expect(environment.INLINE_KEY).toBe("inline")
    expect(environment.OPENCODE_CONFIG_CONTENT).toBe(inline)
    expect(environment.OPENCODE_PERMISSION).toBe('{"edit":"deny"}')
    for(const name of ["COMMENT_SECRET", "UNRELATED_SECRET", "HOME", "PATH", "XDG_CONFIG_HOME"]) expect(environment[name]).toBeUndefined()
    await rm(join(project, ".env"))
    expect((await resolveOpenCodeEnvironment(configuration, await loadDotEnv(project), { OPENAI_API_KEY: "host-key" })).OPENAI_API_KEY).toBe("host-key")
    expect(referencedOpenCodeVariables(['{"providers":{"custom":{"env":["V2_KEY"]}}}'])).toEqual(["V2_KEY"])
  })

  test("JSONC path edits preserve comments, denies, unrelated values, and sibling paths", () => {
    const raw = `{
  // Keep this comment.
  "instructions": ["/host/project/guide.md", "~/.config/opencode/rules.md"],
  "plugin": ["file:///host/home/.config/opencode/plugin.ts"],
  "permission": {"bash":"deny"},
  "unchanged": "/host/project-other/guide.md",
}`
    const remapped = remapOpenCodeConfig(raw, {
      hostHome: "/host/home",
      mappings: [{ host: "/host/project", container: "/home/viber/app" }, { host: "/host/home/.config/opencode", container: "/home/viber/.config/opencode" }]
    })
    expect(remapped).toContain("// Keep this comment.")
    expect(remapped).toContain('"/home/viber/app/guide.md"')
    expect(remapped).toContain('"/home/viber/.config/opencode/rules.md"')
    expect(remapped).toContain('"file:///home/viber/.config/opencode/plugin.ts"')
    expect(remapped).toContain('"permission": {"bash":"deny"}')
    expect(remapped).toContain('"unchanged": "/host/project-other/guide.md"')
  })

  test("remaps native file substitutions and encoded plugin URLs without changing external references", () => {
    const setup = {
      hostHome: "/host/home",
      mappings: [{ host: "/host/project", container: "/home/viber/app" }, { host: "/host/home/.config/opencode", container: "/home/viber/.config/opencode" }]
    }
    const raw = `{
      // Preserve native substitutions and plugin URL suffixes.
      "instructions": ["{file:/host/project/rules.md}", "{file:~/.config/opencode/global.md}", "{file:/outside/rules.md}"],
      "plugin": ["file:///host/home/.config/opencode/my%20plugin.ts?rev=1#cache"]
    }`
    const remapped = remapOpenCodeConfig(raw, setup)
    expect(remapped).toContain("// Preserve native substitutions and plugin URL suffixes.")
    expect(parseOpenCodeConfig(remapped)).toEqual({
      instructions: ["{file:/home/viber/app/rules.md}", "{file:/home/viber/.config/opencode/global.md}", "{file:/outside/rules.md}"],
      plugin: ["file:///home/viber/.config/opencode/my%20plugin.ts?rev=1#cache"]
    })
  })

  test("keeps absolute deny rules effective after mapping project paths, including agent and inline permissions", () => {
    const setup = { hostHome: "/host/home", mappings: [{ host: "/host/project", container: "/home/viber/app" }] }
    const raw = `{
      "permission": {"edit": {
        // Keep private project files denied.
        "/host/project/secrets/**": "deny", "/outside/**": "deny"
      }},
      "agent": {"review": {"permission": {"read": {"/host/project/private/*": "deny"}}}},
      "unrelated": {"/host/project/key": "unchanged"}
    }`
    const remapped = remapOpenCodeConfig(raw, setup)
    expect(remapped).toContain("// Keep private project files denied.")
    expect(parseOpenCodeConfig(remapped)).toEqual({
      permission: { edit: { "/home/viber/app/secrets/**": "deny", "/outside/**": "deny" } },
      agent: { review: { permission: { read: { "/home/viber/app/private/*": "deny" } } } },
      unrelated: { "/host/project/key": "unchanged" }
    })
    expect(parseOpenCodeConfig(remapOpenCodeConfig('{"edit":{"/host/project/secrets/**":"deny"}}', setup, true)))
      .toEqual({ edit: { "/home/viber/app/secrets/**": "deny" } })
  })

  test("copies writable config, auth, MCP auth and session state while leaving the host unchanged", async () => {
    const root = await temporaryDirectory()
    const host = join(root, "host")
    const target = join(root, "container")
    const raw = `// global settings\n{"instructions":["${host}/rules.md"]}`
    await fixture(join(host, "opencode.jsonc"), raw)
    await fixture(join(host, "auth.json"), '{"openai":{"type":"api","key":"synthetic"}}')
    await fixture(join(host, "mcp-auth.json"), '{"example":{"tokens":"synthetic"}}')
    await fixture(join(host, "storage/session/example.json"), '{"id":"session"}')
    await fixture(join(host, "AGENTS.md"), "Existing user instructions.\n")
    for(const name of ["logs", "log", "cache", "node_modules", "bin"]) await fixture(join(host, name, "skip"), "skip")
    await fixture(join(root, "outside"), "outside")
    await symlink(join(root, "outside"), join(host, "outside-link"))
    await symlink(join(root, "missing"), join(host, "broken-link"))
    await symlink(join(host, "auth.json"), join(host, "inside-link"))
    await symlink(host, join(host, "cycle"))
    await chmod(join(host, "opencode.jsonc"), 0o444)
    const setup: OpenCodeSetup = {
      copies: [{ host, container: target, source: host, directory: true }],
      mappings: [{ host, container: target }], configFiles: [], hostHome: root, agentsPath: join(target, "AGENTS.md")
    }
    await prepareOpenCodeFiles(setup, "Sandbox facts.")
    expect(await readFile(join(host, "opencode.jsonc"), "utf-8")).toBe(raw)
    expect(await readFile(join(host, "AGENTS.md"), "utf-8")).toBe("Existing user instructions.\n")
    expect(await readFile(join(target, "opencode.jsonc"), "utf-8")).toContain(`${target}/rules.md`)
    expect((await stat(join(target, "opencode.jsonc"))).mode & 0o200).toBe(0o200)
    for(const name of ["auth.json", "mcp-auth.json"]) expect((await stat(join(target, name))).mode & 0o777).toBe(0o600)
    expect(await readFile(join(target, "inside-link"), "utf-8")).toContain("synthetic")
    expect(await readFile(join(target, "storage/session/example.json"), "utf-8")).toContain("session")
    for(const name of ["logs", "log", "cache", "node_modules", "bin", "outside-link", "broken-link", "cycle"]) expect(await stat(join(target, name)).catch(() => null)).toBeNull()
    await writeFile(join(target, "auth.json"), "refreshed")
    expect(await readFile(join(host, "auth.json"), "utf-8")).toContain("synthetic")
    const agents = await readFile(setup.agentsPath, "utf-8")
    expect(injectOpenCodeSandbox(agents, "Sandbox facts.")).toBe(agents)
    expect(injectOpenCodeSandbox(agents, "New sandbox facts.")).toContain("Existing user instructions.")
    expect(injectOpenCodeSandbox(agents, "New sandbox facts.").match(/sandbox \(start\)/g)).toHaveLength(1)
  })
})
