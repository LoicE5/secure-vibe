// Domains resolved at firewall setup time and added to the iptables allowlist
export const DEFAULT_ALLOWLIST: string[] = [
  "api.anthropic.com",
  "sentry.io",
  "statsig.anthropic.com",
  "statsig.com",
  "registry.npmjs.org",
  "formulae.brew.sh",
  "pypi.org",
  "files.pythonhosted.org"
]

// Domains whose HTTPS connections bypass TLS interception entirely.
// The client handles TLS itself against the real server certificate.
// Required for Anthropic API: Claude CLI uses certificate pinning logic
// incompatible with MITM, and SO_ORIGINAL_DST-based pass-through is unreliable.
export const PASS_THROUGH_HOSTS = new Set([
  "api.anthropic.com",
  "statsig.anthropic.com"
])

// Domains allowed to receive any HTTP method (POST, PUT, PATCH, DELETE).
// All other domains are GET/HEAD/OPTIONS only.
export const API_ALLOWLIST = new Set([
  "api.anthropic.com",
  "statsig.anthropic.com",
  "sentry.io",
  "api.github.com",
  "github.com",
  "uploads.github.com"
])

export const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

export interface FirewallConfig {
  extraAllow: string[]
  extraBlock: string[]
}

export function parseFirewallEnv(): FirewallConfig {
  const extraAllow = (process.env.FIREWALL_ALLOW ?? "")
    .split(",")
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)

  const extraBlock = (process.env.FIREWALL_BLOCK ?? "")
    .split(",")
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)

  return { extraAllow, extraBlock }
}
