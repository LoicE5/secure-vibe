import { BANNED_DIRS } from "../constants"

/** Returns true if `path` resolves to a directory. Swallows fs errors. */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    const fileStat = await Bun.file(path).stat()
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
