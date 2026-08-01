import { homedir } from "os"
import { join } from "path"

/** Host's ~/.claude-code-router — CCR routing config. Mounted read-only, mirrored in. */
export const CCR_CONFIG_DIR = join(homedir(), ".claude-code-router")

/** CCR's config file. Parsed pre-spawn to discover which $VARs to forward (least privilege). */
export const CCR_CONFIG_PATH = join(CCR_CONFIG_DIR, "config.json")

/** CCR 3.x's store. Its presence without a config.json means CCR imported and deleted the JSON. */
export const CCR_CONFIG_SQLITE_PATH = join(CCR_CONFIG_DIR, "config.sqlite")

/** Container image for the CCR provider, published to GHCR (nested paths allowed, unlike Docker Hub). */
export const CCR_IMAGE_NAME = "ghcr.io/loice5/secure-vibe/ccr:latest"

/** Cache file recording the last day the image was checked for updates. */
export const CCR_IMAGE_CHECK_PATH = join(homedir(), ".cache", "secure-vibe", "image-check-ccr")

/** Dockerfile path, passed via -f so it can live outside the build-context root. */
export const CCR_DOCKERFILE_PATH = join(import.meta.dir, "..", "..", "..", "docker", "ccr.dockerfile")
