import { readFile } from "fs/promises"
import { join } from "path"

/**
 * Minimal, dependency-free `.env` reader. The project has no dotenv dependency and
 * we don't want one — this only needs to be a lookup source for env-var *names* that
 * a CCR config.json references via `$VAR`/`${VAR}`. It does NOT mutate process.env and
 * performs NO `$` expansion of values inside the file.
 *
 * Parsing rules (intentionally conservative):
 *   - Skip blank lines and lines whose first non-space char is `#`.
 *   - Split each line on the FIRST `=`; trim the key.
 *   - Accept only keys matching ^[A-Za-z_][A-Za-z0-9_]*$ (silently skip others).
 *   - Trim the value, then strip ONE matching surrounding quote pair ("…" or '…').
 *
 * Returns {} when <dir>/.env is missing or unreadable.
 */
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

/**
 * Returns the unique set of env-var names referenced as `$VAR` or `${VAR}` in `text`.
 * Used to discover which variables a CCR config.json wants interpolated, so the runner
 * can forward exactly those (least privilege) and nothing else.
 */
export function extractVarTokens(text: string): string[] {
  const names = new Set<string>()
  const pattern = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g
  let match: RegExpExecArray | null
  while((match = pattern.exec(text)) !== null) {
    names.add(match[1]!)
  }
  return [...names]
}
