import { homedir } from "os"
import { join } from "path"

/** Host's ~/.config/agy directory — mounted read-only into the container as /home/viber/.config/agy-host. */
export const AGY_CONFIG_DIR = join(homedir(), ".config", "agy")

/** Host's ~/.gemini directory — antigravity-cli settings, plugins, and global GEMINI.md context. Mounted read-only. */
export const GEMINI_DIR = join(homedir(), ".gemini")

/** Portable headless/CI token written by `agy auth login` in a non-interactive session. */
export const AGY_CREDENTIALS_JSON = join(AGY_CONFIG_DIR, "credentials.json")

/** Keyring-encrypted OAuth token from a desktop login — NOT portable into the container (decrypts via the host keyring only). */
export const AGY_CREDENTIALS_ENC = join(GEMINI_DIR, "antigravity-cli", "credentials.enc")

/** Container image for the Antigravity provider, published to GitHub Container Registry (GHCR allows nested paths, unlike Docker Hub). */
export const ANTIGRAVITY_IMAGE_NAME = "ghcr.io/loice5/secure-vibe/antigravity:latest"

/** Per-provider cache file recording the last day the image was pulled for updates. */
export const ANTIGRAVITY_IMAGE_CHECK_PATH = join(homedir(), ".cache", "secure-vibe", "image-check-antigravity")

/** Explicit Dockerfile path, passed via -f so the file can live outside the build-context root. */
export const ANTIGRAVITY_DOCKERFILE_PATH = join(import.meta.dir, "..", "..", "..", "docker", "antigravity.dockerfile")
