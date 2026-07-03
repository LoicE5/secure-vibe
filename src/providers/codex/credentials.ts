import { access, constants, readFile } from "fs/promises"
import { CODEX_AUTH_PATH } from "../../constants"

/**
 * Reads ~/.codex/auth.json and returns its raw contents if it carries auth material
 * (ChatGPT OAuth tokens or an API key). Returns null when the file is missing,
 * unreadable, or doesn't parse. Codex stores auth as plaintext JSON on every
 * platform — no keychain, so this single file is the whole cascade.
 */
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

/**
 * Returns the auth JSON string to inject into the container via env var.
 * Exits the process (code 1) when ~/.codex/auth.json is missing or carries no auth.
 */
export async function resolveCodexCredentials(): Promise<string | null> {
  const fromFile = await readCodexAuthJson()
  if(fromFile) {
    console.info("  Credentials read from ~/.codex/auth.json.")
    return fromFile
  }

  console.error("✗ No credentials found. Please authenticate with Codex (`codex login`) on this machine first.")
  process.exit(1)
}
