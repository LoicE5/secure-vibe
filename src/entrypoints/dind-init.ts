import { openSync } from "fs"
import { readFile } from "fs/promises"
import { $ } from "bun"

const DOCKERD_LOG_PATH = "/home/viber/.dockerd.log"
const PROVIDER_ENTRYPOINT = "/home/viber/entrypoint.ts"

// Registered before dockerd so a ctrl+c during startup cannot kill PID 1, which the
// provider entrypoint only guards from the moment it is imported below.
process.on("SIGINT", () => {})

// Logged to a file, never the TTY: dockerd's output would corrupt the provider's TUI.
const dockerdLogFd = openSync(DOCKERD_LOG_PATH, "a")
const dockerd = Bun.spawn(["/usr/local/bin/dockerd-rootless.sh"], {
  stdin: "ignore",
  stdout: dockerdLogFd,
  stderr: dockerdLogFd
})

type DaemonOutcome = "ready" | "exited" | "timeout"

/** Polls the rootless daemon's socket until it answers a version query. */
async function waitForDaemon(timeoutMs: number): Promise<DaemonOutcome> {
  const deadline = Date.now() + timeoutMs
  while(Date.now() < deadline) {
    if(dockerd.exitCode !== null) return "exited"
    const { exitCode } = await $`docker version --format ${"{{.Server.Version}}"}`.quiet().nothrow()
    if(exitCode === 0) return "ready"
    await Bun.sleep(300)
  }
  return "timeout"
}

/** True when this container cannot create a user namespace — the most common host-side cause. */
async function usernsBlocked(): Promise<boolean> {
  const { exitCode } = await $`unshare --user --map-root-user true`.quiet().nothrow()
  return exitCode !== 0
}

const daemonOutcome = await waitForDaemon(30_000)
if(daemonOutcome === "ready") {
  const { stdout } = await $`docker info --format ${"{{.Driver}}"}`.quiet().nothrow()
  console.info(`  [dind] Rootless Docker ready (storage driver: ${stdout.toString().trim()}).`)
} else {
  const log = await readFile(DOCKERD_LOG_PATH, "utf-8").catch(() => "")
  console.warn("  [dind] ⚠ The rootless Docker daemon did not start — `docker` will not work in this session.")
  if(await usernsBlocked()) {
    console.warn("  [dind]   User namespaces are blocked in this container.")
    console.warn("  [dind]   On Linux hosts, check `sysctl kernel.apparmor_restrict_unprivileged_userns` and update Docker.")
  } else if(log.includes("/dev/net/tun")) {
    console.warn("  [dind]   /dev/net/tun is missing on the Docker host — run `sudo modprobe tun` and retry.")
  } else {
    if(dockerd.exitCode !== null) console.warn(`  [dind]   dockerd-rootless.sh exited with code ${dockerd.exitCode}.`)
    console.warn(`  [dind]   Last lines of ${DOCKERD_LOG_PATH}:`)
    for(const line of log.trimEnd().split("\n").slice(-15)) console.warn(`  [dind]   | ${line}`)
  }
}

await import(PROVIDER_ENTRYPOINT)
