import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

const PROJECT_DIR = join(import.meta.dir, "..")
const PROBE = join(PROJECT_DIR, "test/fixtures/config-probe.ts")
const temporaryDirectories: string[] = []

/** Creates a tracked temporary directory for a test. */
async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "secure-vibe-test-"))
  temporaryDirectories.push(directory)
  return directory
}

/** Runs the shell installer with an isolated home. */
async function runSetup(homeDirectory: string, shell: string): Promise<number> {
  const processHandle = Bun.spawn(["bun", "--no-env-file", "scripts/alias.ts"], {
    cwd: PROJECT_DIR,
    env: { ...process.env, HOME: homeDirectory, SHELL: shell },
    stdout: "ignore",
    stderr: "ignore"
  })
  return processHandle.exited
}

/** Runs the config probe with controlled dotenv and host values. */
async function runProbe(callerDirectory: string, defaultsFile: string, hostProvider?: string): Promise<{
  configuration: { provider: string }
  projectCredential: string | null
  projectControl: string | null
}> {
  const environment = { ...process.env }
  delete environment.SECURE_VIBE_PROVIDER
  if(hostProvider) environment.SECURE_VIBE_PROVIDER = hostProvider

  const processHandle = Bun.spawn(["bun", "--no-env-file", `--env-file=${defaultsFile}`, PROBE], {
    cwd: callerDirectory,
    env: environment,
    stdout: "pipe",
    stderr: "pipe"
  })
  const output = await new Response(processHandle.stdout).text()
  const errorOutput = await new Response(processHandle.stderr).text()
  const exitCode = await processHandle.exited
  expect(errorOutput).toBe("")
  expect(exitCode).toBe(0)
  return JSON.parse(output)
}

afterEach(async () => {
  for(const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe("shell setup", () => {
  for(const shell of ["bash", "zsh"]) {
    test(`${shell} setup is idempotent, migrates aliases, and preserves content`, async () => {
      const homeDirectory = await temporaryDirectory()
      const aliasesFile = join(homeDirectory, `.${shell}_aliases`)
      await writeFile(aliasesFile, [
        "export UNRELATED=value",
        "# secure-vibe alias",
        "alias secure-vibe='bun /old/index.ts'",
        "alias keep-me='printf kept'"
      ].join("\n"))

      expect(await runSetup(homeDirectory, `/bin/${shell}`)).toBe(0)
      expect(await runSetup(homeDirectory, `/bin/${shell}`)).toBe(0)

      const content = await readFile(aliasesFile, "utf8")
      expect(content).toContain("export UNRELATED=value")
      expect(content).toContain("alias keep-me='printf kept'")
      expect(content).not.toContain("alias secure-vibe=")
      expect(content).toContain("unalias secure-vibe 2>/dev/null || true")
      expect(content).toContain("secure-vibe()")
      expect(content).toContain("bun --no-env-file --env-file=")
      expect(content.match(/# secure-vibe alias \(start\)/g)).toHaveLength(1)
      expect(content.match(/# secure-vibe completion \(start\)/g)).toHaveLength(1)
    })
  }

  test("repository defaults beat built-ins, host values beat defaults, and caller controls stay isolated", async () => {
    const temporaryRoot = await temporaryDirectory()
    const callerDirectory = join(temporaryRoot, "caller")
    const defaultsFile = join(temporaryRoot, "repository.env")
    await mkdir(callerDirectory)
    await writeFile(defaultsFile, "SECURE_VIBE_PROVIDER=vibe\n")
    await writeFile(join(callerDirectory, ".env"), "SECURE_VIBE_PROVIDER=invalid\nCCR_TEST_KEY=project-secret\n")

    const defaultsResult = await runProbe(callerDirectory, defaultsFile)
    expect(defaultsResult.configuration.provider).toBe("vibe")
    expect(defaultsResult.projectCredential).toBe("project-secret")
    expect(defaultsResult.projectControl).toBe("invalid")

    const hostResult = await runProbe(callerDirectory, defaultsFile, "codex")
    expect(hostResult.configuration.provider).toBe("codex")
  })

  test("a missing repository dotenv file keeps built-in defaults", async () => {
    const temporaryRoot = await temporaryDirectory()
    const result = await runProbe(temporaryRoot, join(temporaryRoot, "missing.env"))
    expect(result.configuration.provider).toBe("claude")
  })
})
