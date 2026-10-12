import type { ProviderSpec } from "../../types"
import { OPENCODE_IMAGE_NAME, OPENCODE_IMAGE_CHECK_PATH, OPENCODE_DOCKERFILE_PATH } from "../../constants"

export const OPENCODE_PROVIDER_SPEC = {
  id: "opencode",
  imageName: OPENCODE_IMAGE_NAME,
  dockerfilePath: OPENCODE_DOCKERFILE_PATH,
  brewVolumeName: "secure-vibe-brew",
  imageCheckCachePath: OPENCODE_IMAGE_CHECK_PATH,
  dind: false
} satisfies ProviderSpec
