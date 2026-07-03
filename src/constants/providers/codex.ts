import { homedir } from "os"
import { join } from "path"

/** Host's ~/.codex — Codex CLI config/state. Mounted read-only, mirrored in. */
export const CODEX_DIR = join(homedir(), ".codex")

/** Codex's auth file — plaintext JSON on every platform (no keychain). Read pre-spawn, injected via env. */
export const CODEX_AUTH_PATH = join(CODEX_DIR, "auth.json")

/** Container image for the Codex provider, published to GHCR (nested paths allowed, unlike Docker Hub). */
export const CODEX_IMAGE_NAME = "ghcr.io/loice5/secure-vibe/codex:latest"

/** Cache file recording the last day the image was checked for updates. */
export const CODEX_IMAGE_CHECK_PATH = join(homedir(), ".cache", "secure-vibe", "image-check-codex")

/** Dockerfile path, passed via -f so it can live outside the build-context root. */
export const CODEX_DOCKERFILE_PATH = join(import.meta.dir, "..", "..", "..", "docker", "codex.dockerfile")
