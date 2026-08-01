import type { Runtime } from "../types"
import { commandExists, testRuntime } from "./runtime-detect"

/** Detects the container runtime, preferring docker, or exits (code 1) if none is reachable. */
export async function selectRuntime(preValue: string | null): Promise<Runtime> {
  const dockerAvailable = (await commandExists("docker")) && (await testRuntime("docker"))
  const podmanAvailable = (await commandExists("podman")) && (await testRuntime("podman"))

  if(!dockerAvailable && !podmanAvailable) {
    console.error("✗ Neither docker nor podman is available or running. Please start one and try again.")
    process.exit(1)
  }

  if(dockerAvailable && !podmanAvailable) {
    if(preValue && preValue !== "docker") console.warn(`  ⚠ Runtime "${preValue}" not available, using docker.`)
    console.info("  Using docker.")
    return "docker"
  }

  if(podmanAvailable && !dockerAvailable) {
    if(preValue && preValue !== "podman") console.warn(`  ⚠ Runtime "${preValue}" not available, using podman.`)
    console.info("  Using podman.")
    return "podman"
  }

  if(preValue !== null) {
    const normalized = preValue.toLowerCase()
    if(normalized === "docker" || normalized === "podman") {
      console.info(`  Using ${normalized}.`)
      return normalized
    }
    console.warn(`  ✗ Invalid runtime "${preValue}". Expected: docker, podman. Defaulting to docker.`)
  }

  console.info("  Both docker and podman available. Using docker (set RUNTIME or --runtime to override).")
  return "docker"
}
