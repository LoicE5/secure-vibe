import type { ProviderSpec } from "../../types"
import {
  VIBE_IMAGE_NAME,
  VIBE_IMAGE_CHECK_PATH,
  VIBE_DOCKERFILE_PATH
} from "../../constants"

/** Static spec for the Mistral Vibe provider — consumed by the generic image/container helpers. */
export const VIBE_PROVIDER_SPEC: ProviderSpec = {
  id: "vibe",
  imageName: VIBE_IMAGE_NAME,
  dockerfilePath: VIBE_DOCKERFILE_PATH,
  brewVolumeName: "secure-vibe-brew",
  imageCheckCachePath: VIBE_IMAGE_CHECK_PATH,
  dind: false
}
