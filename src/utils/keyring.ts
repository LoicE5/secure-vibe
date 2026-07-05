import { $ } from "bun"

/**
 * Reads a secret from the platform keyring. macOS: Keychain via `security`.
 * Linux: Secret Service (gnome-keyring/KWallet) via `secret-tool` (needs libsecret-tools).
 * Returns null when the platform is unsupported or the secret is absent/unreadable.
 */
export async function readKeyringSecret(service: string, account: string): Promise<string | null> {
  if(process.platform === "darwin") {
    const raw = await $`security find-generic-password -s ${service} -a ${account} -w`
      .text().then(s => s.trim()).catch(() => "")
    return raw || null
  }
  if(process.platform === "linux") {
    const raw = await $`secret-tool lookup service ${service} username ${account}`
      .text().then(s => s.trim()).catch(() => "")
    return raw || null
  }
  return null
}
