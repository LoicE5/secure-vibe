import { resolve } from "path"
import { isDirectory, isBannedDirectory } from "./fs"

/**
 * Resolves the working directory: null/"."/"" → cwd, otherwise absolute resolve of the input.
 * Exits the process (code 1) if the path is missing, not a directory, or in BANNED_DIRS.
 */
export async function selectDirectory(preValue: string | null): Promise<string> {
  const targetPath = (preValue === null || preValue === "." || preValue === "") ? process.cwd() : resolve(preValue)

  if(!(await isDirectory(targetPath))) {
    console.error(`  ✗ Not a valid directory: ${targetPath}`)
    process.exit(1)
  }
  if(isBannedDirectory(targetPath)) {
    console.error(`  ✗ Mounting "${targetPath}" is not allowed for security reasons.`)
    process.exit(1)
  }
  return targetPath
}
