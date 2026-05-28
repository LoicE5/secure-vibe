import { access, stat } from "fs/promises"
import { BANNED_DIRS } from "../constants"

/** Returns true if `path` resolves to a directory. Missing paths return false silently; other stat errors are logged at debug. */
export async function isDirectory(path: string): Promise<boolean> {
  // Bun.file(path).exists() reports false for directories in some Bun versions, so use fs.access.
  const accessible = await access(path).then(() => true).catch(() => false)
  if(!accessible) return false
  try {
    const fileStat = await stat(path)
    return fileStat.isDirectory()
  } catch(statError: unknown) {
    console.debug(`  [fs] stat failed for ${path}:`, statError)
    return false
  }
}

/** Returns true if `absolutePath` matches a forbidden host directory (root, /etc, $HOME, …). */
export function isBannedDirectory(absolutePath: string): boolean {
  return BANNED_DIRS.has(absolutePath)
}

/** Compact ISO timestamp (YYYYMMDDHHmmss) suitable for filenames. */
export function timestamp(): string {
  return new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)
}
