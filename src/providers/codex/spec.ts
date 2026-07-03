import type { ProviderSpec } from "../../types"
import {
  CODEX_IMAGE_NAME,
  CODEX_IMAGE_CHECK_PATH,
  CODEX_DOCKERFILE_PATH
} from "../../constants"

/** Static spec for the Codex provider — consumed by the generic image/container helpers. */
export const CODEX_PROVIDER_SPEC: ProviderSpec = {
  id: "codex",
  imageName: CODEX_IMAGE_NAME,
  dockerfilePath: CODEX_DOCKERFILE_PATH,
  brewVolumeName: "secure-vibe-brew",
  imageCheckCachePath: CODEX_IMAGE_CHECK_PATH
}
