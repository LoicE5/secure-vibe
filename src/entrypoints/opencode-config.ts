import { chmod, copyFile, mkdir, readFile, readdir, realpath, stat, writeFile } from "fs/promises"
import { isAbsolute, join, relative, resolve } from "path"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"

export interface OpenCodePathMapping {
  host: string
  container: string
}

export interface OpenCodeCopy extends OpenCodePathMapping {
  source: string
  directory: boolean
}

export interface OpenCodeSetup {
  copies: OpenCodeCopy[]
  mappings: OpenCodePathMapping[]
  configFiles: string[]
  hostHome: string
  agentsPath: string
}

const SKIPPED_ENTRIES = new Set(["log", "logs", "cache", ".cache", "node_modules", "bin", ".git"])
export const OPENCODE_CONFIG_NAMES = ["config.json", "opencode.json", "opencode.jsonc", "tui.json", "tui.jsonc"]

/** Checks path containment without matching sibling prefixes. */
export function isWithinDirectory(path: string, directory: string): boolean {
  const suffix = relative(directory, path)
  return suffix === "" || (!suffix.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && suffix !== ".." && !isAbsolute(suffix))
}

/** Translates only paths covered by provider copies or the selected project. */
export function translateOpenCodePath(value: string, mappings: OpenCodePathMapping[], hostHome: string): string {
  const prefix = value.startsWith("file://") ? "file://" : ""
  const path = value.slice(prefix.length).replace(/^~(?=\/)/, hostHome)
  if(!isAbsolute(path)) return value
  const mapping = [...mappings].sort((left: OpenCodePathMapping, right: OpenCodePathMapping) => right.host.length - left.host.length)
    .find(candidate => isWithinDirectory(path, candidate.host))
  return mapping ? prefix + join(mapping.container, relative(mapping.host, path)) : value
}

/** Parses JSONC without interpreting comments as environment references. */
export function parseOpenCodeConfig(raw: string): unknown {
  const errors: ParseError[] = []
  const value: unknown = parse(raw, errors, { allowTrailingComma: true })
  if(errors.length > 0) throw new Error("Invalid OpenCode JSON/JSONC configuration")
  return value
}

/** Edits string values in JSONC while retaining comments and unrelated settings. */
export function remapOpenCodeConfig(raw: string, setup: Pick<OpenCodeSetup, "mappings" | "hostHome">): string {
  const config = parseOpenCodeConfig(raw)
  let result = raw
  /** Visits configuration values by their JSON path. */
  function visit(value: unknown, path: (string | number)[]): void {
    if(typeof value === "string") {
      const translated = translateOpenCodePath(value, setup.mappings, setup.hostHome)
      if(translated !== value) result = applyEdits(result, modify(result, path, translated, {}))
    } else if(Array.isArray(value)) {
      value.forEach((entry: unknown, index: number) => visit(entry, [...path, index]))
    } else if(value && typeof value === "object") {
      for(const [key, entry] of Object.entries(value)) visit(entry, [...path, key])
    }
  }
  visit(config, [])
  return result
}

/** Copies selected files, dereferencing only symlinks contained in the mounted source. */
async function copyOpenCodeFiles(source: string, target: string, root: string, ancestors: Set<string>): Promise<void> {
  const canonical = await realpath(source).catch(() => null)
  if(!canonical || !isWithinDirectory(canonical, root) || ancestors.has(canonical)) return
  const metadata = await stat(source)
  if(metadata.isDirectory()) {
    await mkdir(target, { recursive: true, mode: 0o700 })
    await chmod(target, 0o700)
    const nextAncestors = new Set([...ancestors, canonical])
    for(const name of await readdir(source)) {
      if(!SKIPPED_ENTRIES.has(name)) await copyOpenCodeFiles(join(source, name), join(target, name), root, nextAncestors)
    }
  } else if(metadata.isFile()) {
    await mkdir(resolve(target, ".."), { recursive: true, mode: 0o700 })
    await copyFile(source, target)
    await chmod(target, /(?:^|\/)(?:auth|mcp-auth)\.json$/.test(target) ? 0o600 : (metadata.mode & 0o111) | 0o600)
  }
}

/** Replaces the marked sandbox block while preserving global user instructions. */
export function injectOpenCodeSandbox(existing: string, prompt: string): string {
  const start = "<!-- secure-vibe sandbox (start) -->"
  const end = "<!-- secure-vibe sandbox (end) -->"
  const base = existing.replace(/<!-- secure-vibe sandbox \(start\) -->[\s\S]*?<!-- secure-vibe sandbox \(end\) -->/g, "").trimEnd()
  return `${base ? `${base}\n\n` : ""}${start}\n${prompt.trim()}\n${end}\n`
}

/** Prepares writable provider state and remaps only disposable configuration copies. */
export async function prepareOpenCodeFiles(setup: OpenCodeSetup, prompt: string): Promise<void> {
  for(const copy of setup.copies) {
    await copyOpenCodeFiles(copy.source, copy.container, await realpath(copy.source), new Set())
  }
  const configFiles = new Set(setup.configFiles)
  for(const copy of setup.copies.filter(copy => copy.directory)) {
    for(const name of OPENCODE_CONFIG_NAMES) configFiles.add(join(copy.container, name))
  }
  for(const path of configFiles) {
    const raw = await readFile(path, "utf-8").catch(() => null)
    if(raw === null) continue
    try {
      const remapped = remapOpenCodeConfig(raw, setup)
      if(remapped !== raw) await writeFile(path, remapped, { mode: 0o600 })
    } catch(configError: unknown) {
      console.warn(`  [entrypoint] Could not remap OpenCode config ${path}:`, configError)
    }
  }
  if(prompt) {
    await mkdir(resolve(setup.agentsPath, ".."), { recursive: true, mode: 0o700 })
    const existing = await readFile(setup.agentsPath, "utf-8").catch(() => "")
    await writeFile(setup.agentsPath, injectOpenCodeSandbox(existing, prompt))
  }
}
