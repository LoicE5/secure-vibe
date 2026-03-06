import { homedir } from "os"
import { join } from "path"
import type { SaveMode } from "./interfaces"

export const CLAUDE_DIR = join(homedir(), ".claude")
export const CLAUDE_JSON_PATH = join(homedir(), ".claude.json")

export const IMAGE_NAME = "secure-vibe"
// Resolve to the project root (parent of src/) so the Dockerfile is always found,
// regardless of the working directory from which the script is invoked.
export const SCRIPT_DIR = join(import.meta.dir, "..")

export const VALID_SAVE_MODES: SaveMode[] = ["zip", "copy", "no"]

export const BANNED_DIRS: string[] = [
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
]
