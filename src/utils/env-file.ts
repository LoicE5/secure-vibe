import { readFile } from "fs/promises"
import { join } from "path"

/** Minimal `.env` reader: no process.env mutation, no `$` expansion, {} when unreadable. */
export async function loadDotEnv(dir: string): Promise<Record<string, string>> {
  const raw = await readFile(join(dir, ".env"), "utf-8").catch(() => null)
  if(raw === null) return {}

  const result: Record<string, string> = {}
  for(const line of raw.split("\n")) {
    const trimmed = line.trim()
    if(!trimmed || trimmed.startsWith("#")) continue

    const eq = trimmed.indexOf("=")
    if(eq === -1) continue

    const key = trimmed.slice(0, eq).trim()
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue

    let value = trimmed.slice(eq + 1).trim()
    if(value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

/** Returns the unique env-var names referenced as `$VAR` or `${VAR}` in `text`. */
export function extractVarTokens(text: string): string[] {
  const names = new Set<string>()
  const pattern = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g
  let match: RegExpExecArray | null
  while((match = pattern.exec(text)) !== null) {
    names.add(match[1]!)
  }
  return [...names]
}
