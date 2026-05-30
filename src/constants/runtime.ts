import { homedir } from "os"
import type { SaveMode, Runtime } from "../types"

/** Valid CLI values for --save. "no" disables the save step. */
export const VALID_SAVE_MODES: SaveMode[] = ["zip", "copy", "no"]

/** Valid CLI values for --runtime. Mirrors the Runtime type as a value so the parser and completion can share it. */
export const VALID_RUNTIMES: Runtime[] = ["docker", "podman"]

/**
 * Exit codes that indicate a normal user-initiated termination (e.g. typing exit,
 * pressing Ctrl+C). These are mapped to 0 so Bun doesn't print a script error.
 */
export const CLEAN_EXIT_CODES = new Set<number>([
  130, // SIGINT (Ctrl+C / shell exit)
  143 // SIGTERM
])

/** Directories the host workdir mount may never resolve to. Guards against `secure-vibe /` or mounting the user's home. */
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
