import { $ } from "bun"
import { DIND_SUFFIX, DIND_LABEL, DIND_DATA_ROOT, DIND_VOLUME_NAME } from "../constants"
import type { Runtime, ProviderSpec } from "../types"

/** Derives the docker-in-docker variant of a spec: `-dind` image tag and its own update cache. */
export function toDindSpec(spec: ProviderSpec): ProviderSpec {
  return {
    ...spec,
    imageName: `${spec.imageName}${DIND_SUFFIX}`,
    imageCheckCachePath: `${spec.imageCheckCachePath}${DIND_SUFFIX}`,
    dind: true,
    parentImageName: spec.imageName
  }
}

/** Resolves the `-v` argument for the nested daemon's data root, stepping aside if one is live. */
export async function resolveDindDataRoot(runtime: Runtime): Promise<string> {
  const { stdout, exitCode } = await $`${runtime} ps --filter label=${DIND_LABEL} --quiet`.quiet().nothrow()
  const alreadyRunning = exitCode === 0 && stdout.toString().trim().length > 0

  // Two daemons on one containerd data root corrupt it, so the second session gets a
  // throwaway anonymous volume instead — which `--rm` reaps on exit.
  if(alreadyRunning) {
    console.warn(`  ⚠ Another --dind session is running; this one gets a throwaway Docker data root.`)
    return DIND_DATA_ROOT
  }

  return `${DIND_VOLUME_NAME}:${DIND_DATA_ROOT}`
}
