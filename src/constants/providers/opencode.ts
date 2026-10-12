import { homedir } from "os"
import { join } from "path"

export const OPENCODE_IMAGE_NAME = "ghcr.io/loice5/secure-vibe/opencode:latest"
export const OPENCODE_IMAGE_CHECK_PATH = join(homedir(), ".cache", "secure-vibe", "image-check-opencode")
export const OPENCODE_DOCKERFILE_PATH = join(import.meta.dir, "..", "..", "..", "docker", "opencode.dockerfile")
