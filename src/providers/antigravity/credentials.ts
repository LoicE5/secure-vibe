import { access, constants } from "fs/promises"
import { AGY_CREDENTIALS_JSON, AGY_CREDENTIALS_ENC } from "../../constants"

/** What the runner needs to know to authenticate the container. */
export interface AntigravityCredentials {
  /** API key from Google AI Studio, injected as ANTIGRAVITY_API_KEY — the most robust, container-friendly path. */
  apiKey?: string
}

const exists = (path: string): Promise<boolean> =>
  access(path, constants.R_OK).then(() => true).catch(() => false)

/**
 * Resolves how the Antigravity container will authenticate.
 *
 * Unlike Claude (whose OAuth token lives in a portable ~/.claude.json), antigravity
 * stores its desktop OAuth token keyring-encrypted in ~/.gemini/antigravity-cli/credentials.enc,
 * which CANNOT be decrypted inside the container. The portable forms are:
 *   1. ANTIGRAVITY_API_KEY env var (Google AI Studio key) — passed straight through.
 *   2. ~/.config/agy/credentials.json (written by a headless `agy auth login`) — mirrored in via mount.
 *
 * This never exits the process: even with no host credentials, `agy` can run its own
 * login flow inside the container. We only warn so the user knows what to expect.
 */
export async function resolveAntigravityCredentials(): Promise<AntigravityCredentials> {
  const apiKey = process.env.ANTIGRAVITY_API_KEY
  if(apiKey) {
    console.info("  Authenticating with ANTIGRAVITY_API_KEY from the environment.")
    return { apiKey }
  }

  if(await exists(AGY_CREDENTIALS_JSON)) {
    console.info("  Found ~/.config/agy/credentials.json — it will be mounted into the container.")
    return {}
  }

  if(await exists(AGY_CREDENTIALS_ENC)) {
    console.warn("  ⚠ Only a keyring-encrypted token (~/.gemini/antigravity-cli/credentials.enc) was found.")
    console.warn("    It cannot be decrypted inside the container. To get a portable token, run a headless")
    console.warn("    login on the host (e.g. SSH_CONNECTION=\"127.0.0.1 0 127.0.0.1 0\" agy auth login),")
    console.warn("    which writes ~/.config/agy/credentials.json — or set ANTIGRAVITY_API_KEY.")
    return {}
  }

  console.warn("  No Antigravity credentials found on the host — agy will prompt for login inside the container.")
  return {}
}
