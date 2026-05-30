import { access, constants } from "fs/promises"
import { GEMINI_OAUTH_CREDS, AGY_CREDENTIALS_JSON } from "../../constants"

export interface AntigravityCredentials {
  /** Google AI Studio key, injected as ANTIGRAVITY_API_KEY. */
  apiKey?: string
}

const exists = (path: string): Promise<boolean> =>
  access(path, constants.R_OK).then(() => true).catch(() => false)

/**
 * Picks the auth method: ANTIGRAVITY_API_KEY, else the mounted ~/.gemini/oauth_creds.json
 * (or ~/.config/agy/credentials.json). Never exits — agy can log in inside the container.
 */
export async function resolveAntigravityCredentials(): Promise<AntigravityCredentials> {
  const apiKey = process.env.ANTIGRAVITY_API_KEY
  if(apiKey) {
    console.info("  Authenticating with ANTIGRAVITY_API_KEY from the environment.")
    return { apiKey }
  }

  if(await exists(GEMINI_OAUTH_CREDS)) {
    console.info("  Found ~/.gemini/oauth_creds.json — your session will be mounted in.")
    return {}
  }

  if(await exists(AGY_CREDENTIALS_JSON)) {
    console.info("  Found ~/.config/agy/credentials.json — it will be mounted in.")
    return {}
  }

  console.warn("  No host credentials found. Run `agy` to log in or set ANTIGRAVITY_API_KEY; otherwise agy will prompt inside the container.")
  return {}
}
