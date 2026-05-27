import { homedir } from "os"
import { join } from "path"

/** Host's ~/.claude directory — mounted read-only into the container as /home/viber/.claude-host. */
export const CLAUDE_DIR = join(homedir(), ".claude")

/** Path to ~/.claude.json — Claude 2.1.63+ stores credentials here. */
export const CLAUDE_JSON_PATH = join(homedir(), ".claude.json")

/** Docker image reference for the Claude provider. Hyphenated to remain Docker Hub compatible. */
export const CLAUDE_IMAGE_NAME = "docker.io/loice5/secure-vibe-claude:latest"

/** Per-provider cache file recording the last day the image was pulled for updates. */
export const CLAUDE_IMAGE_CHECK_PATH = join(homedir(), ".cache", "secure-vibe", "image-check-claude")

/** Explicit Dockerfile path, passed via -f so the file can live outside the build-context root. */
export const CLAUDE_DOCKERFILE_PATH = join(import.meta.dir, "..", "..", "..", "docker", "claude.dockerfile")
