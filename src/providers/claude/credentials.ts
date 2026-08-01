import { access, constants, readFile } from "fs/promises"
import { join } from "path"
import { $ } from "bun"
import { CLAUDE_DIR, CLAUDE_JSON_PATH } from "../../constants"

/** Reads ~/.claude.json, the primary credential store since Claude 2.1.63, or null. */
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

/** Resolves credentials to inject: ~/.claude.json → macOS keychain → legacy file, else exits. */
export async function resolveClaudeCredentials(): Promise<string | null> {
  const fromFile = await readClaudeJson()
  if(fromFile) {
    console.info("  Credentials read from ~/.claude.json.")
    return fromFile
  }

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
