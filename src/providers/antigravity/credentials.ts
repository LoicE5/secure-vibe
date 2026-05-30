import { access, constants, readFile } from "fs/promises"
import { $ } from "bun"
import { AGY_TOKEN_HOST_FILE } from "../../constants"

export interface AntigravityCredentials {
  /** agy OAuth token JSON — entrypoint writes it to the container's token file. */
  token?: string
  /** ANTIGRAVITY_API_KEY passthrough (alternative to the OAuth token). */
  apiKey?: string
}

/** macOS Keychain (service, account) pairs agy may store its token under, most likely first. */
const KEYCHAIN_CANDIDATES: ReadonlyArray<readonly [service: string, account: string]> = [
  ["gemini", "antigravity"]
]

/**
 * Resolves the host's agy token to inject; the entrypoint writes it to the file agy
 * reads in container mode so the session starts logged in — same idea as Claude.
 * Prefers a token file at ~/.gemini/antigravity-cli/antigravity-oauth-token (drop one
 * there to skip Keychain prompts), then the macOS Keychain.
 */
export async function resolveAntigravityCredentials(): Promise<AntigravityCredentials> {
  const out: AntigravityCredentials = {}
  if(process.env.ANTIGRAVITY_API_KEY) out.apiKey = process.env.ANTIGRAVITY_API_KEY

  // Token file on the host (also where a container login can be copied back to).
  const fileExists = await access(AGY_TOKEN_HOST_FILE, constants.R_OK).then(() => true).catch(() => false)
  if(fileExists) {
    out.token = (await readFile(AGY_TOKEN_HOST_FILE, "utf-8")).trim()
    console.info("  Read agy token from ~/.gemini/antigravity-cli/antigravity-oauth-token.")
    return out
  }

  // macOS: read agy's token from the Keychain.
  if(process.platform === "darwin") {
    for(const [service, account] of KEYCHAIN_CANDIDATES) {
      const token = await readKeychain(service, account)
      if(token) {
        console.info(`  Read agy token from the macOS Keychain (${service}/${account}).`)
        out.token = token
        return out
      }
    }
  }

  if(!out.apiKey) {
    console.warn("  No agy token found (file/Keychain) and no ANTIGRAVITY_API_KEY — agy will prompt for login.")
  }
  return out
}

/** go-keyring base64-encodes stored values with this prefix; agy's token file wants the raw JSON. */
const KEYRING_BASE64_PREFIX = "go-keyring-base64:"

/** Returns the keychain secret for service/account (decoded to raw JSON), or null if absent. */
async function readKeychain(service: string, account: string): Promise<string | null> {
  const value = await $`security find-generic-password -s ${service} -a ${account} -w`
    .text().then(s => s.trim()).catch(() => "")
  if(!value) return null
  if(value.startsWith(KEYRING_BASE64_PREFIX)) {
    return Buffer.from(value.slice(KEYRING_BASE64_PREFIX.length), "base64").toString("utf-8")
  }
  return value
}
