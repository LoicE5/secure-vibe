import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

const temporaryDirectories: string[] = []

/** Creates wrapper fixtures with a fake CLI that records argument boundaries. */
async function wrapperFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "secure-vibe-opencode-shell-"))
  temporaryDirectories.push(directory)
  const binary = join(directory, "real")
  await writeFile(binary, '#!/usr/bin/env bash\nprintf "%s\\n" "$@"\n', { mode: 0o755 })
  const wrapper = (await readFile(join(import.meta.dir, "opencode-wrapper.sh"), "utf-8")).replaceAll("/home/viber/.opencode/bin/opencode", binary)
  await writeFile(join(directory, "opencode"), wrapper, { mode: 0o755 })
  return directory
}

afterEach(async () => {
  for(const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true })
})

describe("OpenCode shell launch behavior", () => {
  test("wraps interactive and run invocations including global options and delimiters", async () => {
    const directory = await wrapperFixture()
    for(const [args, expected] of [
      [[], ["--yolo"]],
      [["/project with spaces", "--model", "custom/model"], ["--yolo", "/project with spaces", "--model", "custom/model"]],
      [["--model", "models", "run", "hello world"], ["--model", "models", "run", "--yolo", "hello world"]],
      [["run", "--", "literal --help"], ["run", "--yolo", "--", "literal --help"]]
    ]) {
      const child = Bun.spawn([join(directory, "opencode"), ...args], { stdout: "pipe", stderr: "pipe" })
      expect((await new Response(child.stdout).text()).trimEnd().split("\n")).toEqual(expected)
      expect(await child.exited).toBe(0)
    }
  })

  test("utility commands preserve arguments without unsupported approval flags", async () => {
    const directory = await wrapperFixture()
    for(const args of [["auth", "login"], ["providers", "list"], ["plugin", "example"], ["models", "openai"], ["debug", "config"], ["--version"], ["--help"], ["mcp", "list"]]) {
      const child = Bun.spawn([join(directory, "opencode"), ...args], { stdout: "pipe", stderr: "pipe" })
      expect((await new Response(child.stdout).text()).trimEnd().split("\n")).toEqual(args)
      expect(await child.exited).toBe(0)
    }
  })

  test("only the initial interactive shell auto-starts and leaves restart guidance", async () => {
    const directory = await wrapperFixture()
    const raw = await readFile(join(import.meta.dir, "opencode-bashrc-append.sh"), "utf-8")
    const snippet = raw.replace('/home/viber/bin', directory)
    for(const [level, explicit, started, launches] of [[1, "", "", true], [2, "", "", false], [1, "1", "", false], [1, "", "1", false]] as const) {
      const child = Bun.spawn(["bash", "--noprofile", "--norc", "-c", `SHLVL=${level}\n${snippet}\nprintf 'shell remains available\\n'`], {
        env: { ...process.env, SECURE_VIBE_EXPLICIT_CMD: explicit, SECURE_VIBE_OPENCODE_STARTED: started }, stdout: "pipe", stderr: "pipe"
      })
      const output = await new Response(child.stdout).text()
      expect(output.includes("--yolo")).toBe(launches)
      expect(output.includes("Type 'opencode' to restart")).toBe(launches)
      expect(output).toContain("shell remains available")
      expect(await child.exited).toBe(0)
    }
  })
})
