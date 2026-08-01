import type { ProviderSpec } from "../../types"
import {
  CCR_IMAGE_NAME,
  CCR_IMAGE_CHECK_PATH,
  CCR_DOCKERFILE_PATH
} from "../../constants"

/** Static spec for the CCR (claude-code-router) provider — consumed by the generic image/container helpers. */
export const CCR_PROVIDER_SPEC: ProviderSpec = {
  id: "ccr",
  imageName: CCR_IMAGE_NAME,
  dockerfilePath: CCR_DOCKERFILE_PATH,
  // Shared with Claude/agy: the volume only caches provider-neutral brew tooling.
  brewVolumeName: "secure-vibe-brew",
  imageCheckCachePath: CCR_IMAGE_CHECK_PATH,
  dind: false
}
