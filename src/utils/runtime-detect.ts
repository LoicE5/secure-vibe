import { $ } from "bun"

/** Returns true if `command` resolves to an executable on PATH. */
export async function commandExists(command: string): Promise<boolean> {
  return Bun.which(command) !== null
}

/** Returns true if `<runtime> info` succeeds — i.e. the runtime daemon is reachable. */
export async function testRuntime(runtime: string): Promise<boolean> {
  const { exitCode } = await $`${runtime} info`.quiet().nothrow()
  return exitCode === 0
}
