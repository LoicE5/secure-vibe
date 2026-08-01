import { access, constants, readFile } from "fs/promises"
import { CODEX_AUTH_PATH } from "../../constants"

/** Reads ~/.codex/auth.json — plaintext on every platform, so the whole cascade — or null. */
export async function readCodexAuthJson(): Promise<string | null> {
  const exists = await access(CODEX_AUTH_PATH, constants.R_OK).then(() => true).catch(() => false)
  if(!exists) return null

  try {
    const raw = await readFile(CODEX_AUTH_PATH, "utf-8")
    const content = JSON.parse(raw) as Record<string, unknown>
    if(!content.tokens && !content.OPENAI_API_KEY) return null
    return raw
  } catch(readError: unknown) {
    console.warn("  Could not parse ~/.codex/auth.json:", readError)
    return null
  }
}

/** Resolves the auth JSON to inject, or exits (code 1) when none is readable. */
export async function resolveCodexCredentials(): Promise<string | null> {
  const fromFile = await readCodexAuthJson()
  if(fromFile) {
    console.info("  Credentials read from ~/.codex/auth.json.")
    return fromFile
  }

  console.error("✗ No credentials found. Please authenticate with Codex (`codex login`) on this machine first.")
  process.exit(1)
}
