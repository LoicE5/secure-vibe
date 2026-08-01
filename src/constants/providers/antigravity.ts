import { homedir } from "os"
import { join } from "path"

/** Host's ~/.gemini — agy settings/state. Mounted read-only, mirrored in. */
export const GEMINI_DIR = join(homedir(), ".gemini")

/** Where agy reads its token in a container, having detected /.dockerenv and skipped the keyring. */
export const AGY_TOKEN_REL_PATH = "antigravity-cli/antigravity-oauth-token"

/** Same file on a Linux host that already ran agy headless — read directly if present. */
export const AGY_TOKEN_HOST_FILE = join(GEMINI_DIR, AGY_TOKEN_REL_PATH)

/** Container image, published to GHCR (nested paths allowed, unlike Docker Hub). */
export const ANTIGRAVITY_IMAGE_NAME = "ghcr.io/loice5/secure-vibe/antigravity:latest"

/** Cache file recording the last day the image was checked for updates. */
export const ANTIGRAVITY_IMAGE_CHECK_PATH = join(homedir(), ".cache", "secure-vibe", "image-check-antigravity")

/** Dockerfile path, passed via -f so it can live outside the build-context root. */
export const ANTIGRAVITY_DOCKERFILE_PATH = join(import.meta.dir, "..", "..", "..", "docker", "antigravity.dockerfile")
