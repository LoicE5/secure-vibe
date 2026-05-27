import type { ProviderSpec } from "../../types"
import {
  CLAUDE_IMAGE_NAME,
  CLAUDE_IMAGE_CHECK_PATH,
  CLAUDE_DOCKERFILE_PATH
} from "../../constants"

/** Static spec for the Claude provider — consumed by the generic image/container helpers. */
export const CLAUDE_PROVIDER_SPEC: ProviderSpec = {
  id: "claude",
  imageName: CLAUDE_IMAGE_NAME,
  dockerfilePath: CLAUDE_DOCKERFILE_PATH,
  brewVolumeName: "secure-vibe-brew",
  imageCheckCachePath: CLAUDE_IMAGE_CHECK_PATH
}
