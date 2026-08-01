import { VIBE_DIR } from "../../constants"
import { loadDotEnv } from "../../utils/env-file"
import { readKeyringSecret } from "../../utils/keyring"

// vibe's wizard prefers the keyring and deletes the plaintext ~/.vibe/.env copy once it works.
const KEYRING_SERVICES = ["ai.mistral.vibe", "vibe"] as const
const API_KEY_ENV_VAR = "MISTRAL_API_KEY"

/** Resolves the Mistral API key in vibe's own order: env → keyring → ~/.vibe/.env, else exits. */
export async function resolveVibeCredentials(): Promise<string> {
  const fromEnv = process.env[API_KEY_ENV_VAR]
  if(fromEnv) {
    console.info("  Credentials read from the MISTRAL_API_KEY environment variable.")
    return fromEnv
  }

  for(const service of KEYRING_SERVICES) {
    const fromKeyring = await readKeyringSecret(service, API_KEY_ENV_VAR)
    if(fromKeyring) {
      console.info(`  Credentials read from the OS keyring (${service}/${API_KEY_ENV_VAR}).`)
      return fromKeyring
    }
  }

  const fromDotEnv = (await loadDotEnv(VIBE_DIR))[API_KEY_ENV_VAR]
  if(fromDotEnv) {
    console.info("  Credentials read from ~/.vibe/.env.")
    return fromDotEnv
  }

  console.error("✗ No Mistral API key found. Run `vibe` once on this machine to sign in, or export MISTRAL_API_KEY.")
  console.error("  On Linux, reading the key from the keyring needs `secret-tool` (libsecret-tools).")
  process.exit(1)
}
