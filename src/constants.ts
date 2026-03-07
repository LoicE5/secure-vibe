import { homedir } from "os"
import { join } from "path"
import type { SaveMode } from "./interfaces"

export const CLAUDE_DIR = join(homedir(), ".claude")
export const CLAUDE_JSON_PATH = join(homedir(), ".claude.json")

export const IMAGE_NAME = "docker.io/loice5/secure-vibe:latest"
export const IMAGE_CHECK_PATH = join(homedir(), ".claude", "secure-vibe-image-check")
// Project root — used as the Docker build context so COPY paths resolve correctly.
export const PROJECT_DIR = join(import.meta.dir, "..")
// Explicit Dockerfile path, passed via -f so the file can live outside the build context root.
export const DOCKERFILE_PATH = join(import.meta.dir, "..", "docker", "Dockerfile")

export const VALID_SAVE_MODES: SaveMode[] = ["zip", "copy", "no"]

// Exit codes that indicate a normal user-initiated termination (e.g. typing exit,
// pressing Ctrl+C). These are mapped to 0 so Bun doesn't print a script error.
export const CLEAN_EXIT_CODES = new Set<number>([
  130, // SIGINT (Ctrl+C / shell exit)
  143 // SIGTERM
])

export const BANNED_DIRS = new Set<string>([
  homedir(),
  "/",
  "/etc",
  "/usr",
  "/bin",
  "/sbin",
  "/lib",
  "/lib64",
  "/var",
  "/tmp",
  "/proc",
  "/sys",
  "/dev",
  "/boot"
])
