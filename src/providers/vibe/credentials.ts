import { $ } from "bun"
import { VIBE_DIR } from "../../constants"
import { loadDotEnv } from "../../utils/env-file"

// vibe's setup wizard prefers the OS keyring: service "ai.mistral.vibe" (legacy "vibe"),
// account = the env var name. When the keyring write succeeds, vibe deletes the plaintext
// ~/.vibe/.env copy, so the keyring is the primary source on macOS/desktop Linux.
const KEYRING_SERVICES = ["ai.mistral.vibe", "vibe"] as const
const API_KEY_ENV_VAR = "MISTRAL_API_KEY"

/**
 * Resolves the host's Mistral API key to inject into the container as MISTRAL_API_KEY.
 * Inside the container, vibe resolves keys process-env-first (its ~/.vibe/.env load never
 * overrides existing vars and its keyring lookup fails gracefully), so the env var always wins.
 * Order mirrors vibe's own persistence: MISTRAL_API_KEY env → OS keyring (macOS Keychain /
 * Linux Secret Service) → ~/.vibe/.env. Exits the process (code 1) when nothing is found.
 */
export async function resolveVibeCredentials(): Promise<string> {
  const fromEnv = process.env[API_KEY_ENV_VAR]
  if(fromEnv) {
    console.info("  Credentials read from the MISTRAL_API_KEY environment variable.")
    return fromEnv
  }

  const fromKeyring = await readOsKeyring()
  if(fromKeyring) {
    console.info("  Credentials read from the OS keyring (ai.mistral.vibe/MISTRAL_API_KEY).")
    return fromKeyring
  }

  const fromDotEnv = (await loadDotEnv(VIBE_DIR))[API_KEY_ENV_VAR]
  if(fromDotEnv) {
    console.info("  Credentials read from ~/.vibe/.env.")
    return fromDotEnv
  }

  console.error("✗ No Mistral API key found. Run `vibe` once on this machine to sign in, or export MISTRAL_API_KEY.")
  process.exit(1)
}

/**
 * Reads vibe's API key from the platform keyring. macOS: Keychain via `security`.
 * Linux: Secret Service (gnome-keyring/KWallet) via `secret-tool` when installed.
 * Returns null if unavailable — caller falls back to ~/.vibe/.env.
 */
async function readOsKeyring(): Promise<string | null> {
  for(const service of KEYRING_SERVICES) {
    let raw = ""
    if(process.platform === "darwin") {
      raw = await $`security find-generic-password -s ${service} -a ${API_KEY_ENV_VAR} -w`
        .text().then(s => s.trim()).catch(() => "")
    } else if(process.platform === "linux") {
      raw = await $`secret-tool lookup service ${service} username ${API_KEY_ENV_VAR}`
        .text().then(s => s.trim()).catch(() => "")
    }
    if(raw) return raw
  }
  return null
}
