import { access, constants, readFile } from "fs/promises"
import { AGY_TOKEN_HOST_FILE } from "../../constants"
import { readKeyringSecret } from "../../utils/keyring"

export interface AntigravityCredentials {
  /** agy OAuth token JSON — entrypoint writes it to the container's token file. */
  token?: string
  /** ANTIGRAVITY_API_KEY passthrough (alternative to the OAuth token). */
  apiKey?: string
}

// agy stores its OAuth token in the OS keyring (go-keyring) under these coordinates.
const KEYRING_SERVICE = "gemini"
const KEYRING_ACCOUNT = "antigravity"
// go-keyring base64-encodes stored values with this prefix; agy's token file wants raw JSON.
const KEYRING_BASE64_PREFIX = "go-keyring-base64:"

/** Resolves the agy token to inject: ANTIGRAVITY_API_KEY → OS keyring → token file → warn. */
export async function resolveAntigravityCredentials(): Promise<AntigravityCredentials> {
  const out: AntigravityCredentials = {}
  if(process.env.ANTIGRAVITY_API_KEY) out.apiKey = process.env.ANTIGRAVITY_API_KEY

  const fromKeyring = await readOsKeyring()
  if(fromKeyring) {
    console.info("  Read agy token from the OS keyring (gemini/antigravity).")
    out.token = fromKeyring
    return out
  }

  const fileExists = await access(AGY_TOKEN_HOST_FILE, constants.R_OK).then(() => true).catch(() => false)
  if(fileExists) {
    out.token = (await readFile(AGY_TOKEN_HOST_FILE, "utf-8")).trim()
    console.info("  Read agy token from ~/.gemini/antigravity-cli/antigravity-oauth-token.")
    return out
  }

  if(!out.apiKey) {
    console.warn("  No agy token found (keyring/file) and no ANTIGRAVITY_API_KEY — agy will prompt for login.")
  }
  return out
}

/** Reads agy's keyring token, undoing go-keyring's base64 wrapping, or null. */
async function readOsKeyring(): Promise<string | null> {
  const raw = await readKeyringSecret(KEYRING_SERVICE, KEYRING_ACCOUNT)
  if(!raw) return null
  return raw.startsWith(KEYRING_BASE64_PREFIX)
    ? Buffer.from(raw.slice(KEYRING_BASE64_PREFIX.length), "base64").toString("utf-8")
    : raw
}
