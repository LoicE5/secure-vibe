import { readFile, rename, mkdir, stat, access } from "fs/promises"
import { dirname, basename, join } from "path"
import { $ } from "bun"
import type { SecretEntry } from "../types"
import { timestamp } from "./fs"

/** Splits a comma-separated list of glob patterns, trimming whitespace and dropping empties. */
export function parseExcludePatterns(raw: string): string[] {
  return raw.split(",").map(pattern => pattern.trim()).filter(pattern => pattern.length > 0)
}

/** Resolves the union of files matching `patterns` under `workDir`. */
export async function resolveExcludedFiles(workDir: string, patterns: string[]): Promise<string[]> {
  const seen = new Set<string>()
  for(const pattern of patterns) {
    const glob = new Bun.Glob(pattern)
    for await(const relPath of glob.scan({ cwd: workDir, onlyFiles: true, dot: true })) {
      seen.add(relPath)
    }
    // Bare names may be directories, which glob.scan above does not cover; move them as a unit.
    if(!pattern.includes("*") && !pattern.includes("/")) {
      const targetPath = join(workDir, pattern)
      const targetExists = await access(targetPath).then(() => true).catch(() => false)
      if(targetExists) {
        try {
          const entryStat = await stat(targetPath)
          if(entryStat.isDirectory()) seen.add(pattern)
        } catch(statError: unknown) {
          console.debug(`  [secrets] stat skipped for ${pattern}:`, statError)
        }
      }
    }
  }
  return [...seen].sort()
}

/** Returns true if `git check-ignore` reports the path as gitignored within `workDir`. */
export async function isGitIgnored(workDir: string, relPath: string): Promise<boolean> {
  const { exitCode } = await $`git check-ignore -q ${relPath}`.cwd(workDir).quiet().nothrow()
  return exitCode === 0
}

/** Moves `relPaths` into a sibling secrets directory, with a manifest for moveSecretsBack. */
export async function moveSecretsOut(workDir: string, relPaths: string[]): Promise<string> {
  const secretsDir = join(dirname(workDir), `${basename(workDir)}-${timestamp()}-secrets`)
  await mkdir(secretsDir, { recursive: true })

  const manifest: SecretEntry[] = []

  for(const relPath of relPaths) {
    const ignored = await isGitIgnored(workDir, relPath)
    if(!ignored) {
      console.warn(`\x1b[33m  ⚠ ${relPath} is not gitignored — moving it will affect git status\x1b[0m`)
    }

    const flatName = relPath.replaceAll("/", "__")
    await rename(join(workDir, relPath), join(secretsDir, flatName))
    manifest.push({ flatName, originalRelPath: relPath })
  }

  await Bun.write(join(secretsDir, "manifest.json"), JSON.stringify(manifest, null, 2))
  return secretsDir
}

/** Restores files displaced by moveSecretsOut; the secrets directory is left for the user. */
export async function moveSecretsBack(workDir: string, secretsDir: string): Promise<void> {
  let manifest: SecretEntry[]
  try {
    manifest = JSON.parse(await readFile(join(secretsDir, "manifest.json"), "utf-8")) as SecretEntry[]
  } catch(manifestError: unknown) {
    console.error("  ✗ Could not read secrets manifest — files were NOT restored:", manifestError)
    return
  }

  for(const { flatName, originalRelPath } of manifest) {
    try {
      const destination = join(workDir, originalRelPath)
      await mkdir(dirname(destination), { recursive: true })
      await rename(join(secretsDir, flatName), destination)
      console.info(`  Restored: ${originalRelPath}`)
    } catch(restoreError: unknown) {
      console.error(`  ✗ Failed to restore ${originalRelPath}:`, restoreError)
    }
  }

  console.warn(`\x1b[33m  ⚠ Secrets directory was NOT deleted: ${secretsDir}\n  Delete it manually once you have confirmed all files are restored.\x1b[0m`)
}
