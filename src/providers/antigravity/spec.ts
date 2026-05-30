import type { ProviderSpec } from "../../types"
import {
  ANTIGRAVITY_IMAGE_NAME,
  ANTIGRAVITY_IMAGE_CHECK_PATH,
  ANTIGRAVITY_DOCKERFILE_PATH
} from "../../constants"

/** Static spec for the Antigravity provider — consumed by the generic image/container helpers. */
export const ANTIGRAVITY_PROVIDER_SPEC: ProviderSpec = {
  id: "antigravity",
  imageName: ANTIGRAVITY_IMAGE_NAME,
  dockerfilePath: ANTIGRAVITY_DOCKERFILE_PATH,
  // Distinct from Claude's "secure-vibe-brew" so the two providers' brew volumes never collide.
  brewVolumeName: "secure-vibe-antigravity-brew",
  imageCheckCachePath: ANTIGRAVITY_IMAGE_CHECK_PATH
}
