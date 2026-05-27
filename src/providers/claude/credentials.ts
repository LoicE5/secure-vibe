import { access, constants, readFile } from "fs/promises"
import { join } from "path"
import { $ } from "bun"
import { CLAUDE_DIR, CLAUDE_JSON_PATH } from "../../constants"

/**
 * Reads ~/.claude.json and returns its raw contents if it contains a claudeAiOauth field.
 * Returns null when the file is missing, unreadable, or doesn't carry auth tokens.
 * Claude 2.1.63+ stores credentials there (not in ~/.claude/.credentials.json).
 */
export async function readClaudeJson(): Promise<string | null> {
  const exists = await access(CLAUDE_JSON_PATH, constants.R_OK).then(() => true).catch(() => false)
  if(!exists) return null

  try {
    const raw = await readFile(CLAUDE_JSON_PATH, "utf-8")
    const content = JSON.parse(raw) as Record<string, unknown>
    if(!content.claudeAiOauth) return null
    return raw
  } catch(readError: unknown) {
    console.warn("  Could not parse ~/.claude.json:", readError)
    return null
  }
}

/**
 * Returns the credentials JSON string to inject into the container via env var.
 * Cascade: ~/.claude.json → macOS keychain (darwin) → legacy ~/.claude/.credentials.json.
 * Exits the process (code 1) when no credential source is reachable.
 */
export async function resolveClaudeCredentials(): Promise<string | null> {
  // Primary: read from ~/.claude.json (Claude 2.1.63+, works on all platforms)
  const fromFile = await readClaudeJson()
  if(fromFile) {
    console.info("  Credentials read from ~/.claude.json.")
    return fromFile
  }

  // macOS fallback: pull from keychain (older Claude or fresh install)
  if(process.platform === "darwin") {
    console.info("  ~/.claude.json not found. Trying macOS keychain…")
    try {
      const serviceName = "Claude Code-credentials"
      const credentialsJson = (await $`security find-generic-password -s ${serviceName} -w`.text()).trim()
      if(!credentialsJson) {
        console.error("✗ Keychain entry for 'Claude Code-credentials' was empty.")
        process.exit(1)
      }
      console.info("  Credentials extracted from keychain.")
      return credentialsJson
    } catch(keychainError: unknown) {
      console.error("✗ Failed to read credentials from keychain:", keychainError)
      process.exit(1)
    }
  }

  // Linux: check old .credentials.json location as last resort
  const legacyFile = join(CLAUDE_DIR, ".credentials.json")
  const legacyExists = await access(legacyFile, constants.R_OK).then(() => true).catch(() => false)
  if(legacyExists) {
    const content = await readFile(legacyFile, "utf-8")
    console.info("  Credentials read from ~/.claude/.credentials.json.")
    return content
  }

  console.error("✗ No credentials found. Please authenticate with Claude Code on this machine first.")
  process.exit(1)
}
