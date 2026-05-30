import { homedir } from "os"
import { join } from "path"

/** Host's ~/.gemini — agy's OAuth token, account, settings, and antigravity-cli state. Mounted read-only. */
export const GEMINI_DIR = join(homedir(), ".gemini")

/** Portable plaintext OAuth token from a personal login (no keychain, macOS and Linux alike). */
export const GEMINI_OAUTH_CREDS = join(GEMINI_DIR, "oauth_creds.json")

/** Host's ~/.config/agy — only some CI/headless setups use it; mounted when present. */
export const AGY_CONFIG_DIR = join(homedir(), ".config", "agy")

/** Token some CI/headless setups cache (see AGY_CONFIG_DIR). */
export const AGY_CREDENTIALS_JSON = join(AGY_CONFIG_DIR, "credentials.json")

/** Container image, published to GHCR (nested paths allowed, unlike Docker Hub). */
export const ANTIGRAVITY_IMAGE_NAME = "ghcr.io/loice5/secure-vibe/antigravity:latest"

/** Cache file recording the last day the image was checked for updates. */
export const ANTIGRAVITY_IMAGE_CHECK_PATH = join(homedir(), ".cache", "secure-vibe", "image-check-antigravity")

/** Dockerfile path, passed via -f so it can live outside the build-context root. */
export const ANTIGRAVITY_DOCKERFILE_PATH = join(import.meta.dir, "..", "..", "..", "docker", "antigravity.dockerfile")
