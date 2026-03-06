import { homedir } from "os"
import { join } from "path"
import type { SaveMode } from "./interfaces"

export const CLAUDE_DIR = join(homedir(), ".claude")
export const CLAUDE_JSON_PATH = join(homedir(), ".claude.json")

export const IMAGE_NAME = "secure-vibe"
// Project root — used as the Docker build context so COPY paths resolve correctly.
export const PROJECT_DIR = join(import.meta.dir, "..")
// Explicit Dockerfile path, passed via -f so the file can live outside the build context root.
export const DOCKERFILE_PATH = join(import.meta.dir, "..", "docker", "Dockerfile")

export const VALID_SAVE_MODES: SaveMode[] = ["zip", "copy", "no"]

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
