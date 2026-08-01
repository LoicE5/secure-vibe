import { $ } from "bun"
import type { GitIdentity } from "../types"

const GIT_FALLBACK_NAME = "Claude"
const GIT_FALLBACK_EMAIL = "noreply@anthropic.com"

/** Runs `git config <args>`, returning the trimmed stdout or null on any failure. */
async function tryGitConfig(args: string[]): Promise<string | null> {
  try {
    const { exitCode, stdout } = await $`git config ${args}`.quiet().nothrow()
    return exitCode === 0 ? stdout.toString().trim() || null : null
  } catch(gitError: unknown) {
    console.debug("  [git-identity] git config failed:", gitError)
    return null
  }
}

/** Resolves the host git identity, falling back to a hard-coded "Claude" one when unset. */
export async function resolveGitConfig(): Promise<GitIdentity> {
  // No flag reads local → global → system; --global covers the cwd not being a repo.
  const name = (await tryGitConfig(["user.name"])) ?? (await tryGitConfig(["--global", "user.name"]))
  const email = (await tryGitConfig(["user.email"])) ?? (await tryGitConfig(["--global", "user.email"]))

  const resolvedName = name ?? GIT_FALLBACK_NAME
  const resolvedEmail = email ?? GIT_FALLBACK_EMAIL

  if(name && email) {
    console.info(`\x1b[32m  Git identity forwarded from host: ${name} <${email}>\x1b[0m`)
  } else {
    const missing = [!name && "user.name", !email && "user.email"].filter(Boolean).join(", ")
    console.error(`\x1b[31m  ✗ git ${missing} not found on host — falling back to: ${resolvedName} <${resolvedEmail}>\x1b[0m`)
  }

  return { name: resolvedName, email: resolvedEmail }
}
