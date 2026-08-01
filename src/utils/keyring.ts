import { $ } from "bun"

/** Reads a secret from the platform keyring (macOS `security`, Linux `secret-tool`), or null. */
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
