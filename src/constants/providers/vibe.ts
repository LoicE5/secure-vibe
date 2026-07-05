import { homedir } from "os"
import { join } from "path"

/** Host's ~/.vibe — Mistral Vibe config/state. Mounted read-only, mirrored in. */
export const VIBE_DIR = join(homedir(), ".vibe")

/** Container image for the Vibe provider, published to GHCR (nested paths allowed, unlike Docker Hub). */
export const VIBE_IMAGE_NAME = "ghcr.io/loice5/secure-vibe/vibe:latest"

/** Cache file recording the last day the image was checked for updates. */
export const VIBE_IMAGE_CHECK_PATH = join(homedir(), ".cache", "secure-vibe", "image-check-vibe")

/** Dockerfile path, passed via -f so it can live outside the build-context root. */
export const VIBE_DOCKERFILE_PATH = join(import.meta.dir, "..", "..", "..", "docker", "vibe.dockerfile")
