import { DEFAULT_ALLOWLIST, parseFirewallEnv } from "./rules"

const CA_DIR = "/home/mitm/.mitmproxy"

// ── Helpers ───────────────────────────────────────────────────────────────────

async function run(args: string[]): Promise<void> {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
  const exitCode = await proc.exited
  if(exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`Command failed (${exitCode}): ${args.join(" ")}\n${stderr}`)
  }
}

async function runOptional(args: string[]): Promise<void> {
  try {
    await run(args)
  } catch { /* optional — failure is expected and ignored */ }
}

async function resolveDomain(domain: string): Promise<{ v4: string[], v6: string[] }> {
  const v4: string[] = []
  const v6: string[] = []
  try {
    const records4 = await Bun.dns.resolve(domain, "A")
    for(const record of records4) v4.push(record.address)
  } catch {
    console.warn(`[firewall] No A records for ${domain}`)
  }
  try {
    const records6 = await Bun.dns.resolve(domain, "AAAA")
    for(const record of records6) v6.push(record.address)
  } catch {
    // IPv6 records are optional
  }
  return { v4, v6 }
}

async function addToIpset(setName: string, cidr: string): Promise<void> {
  try {
    await run(["ipset", "add", setName, cidr])
  } catch {
    // Duplicate entries are fine
  }
}

function isIPv4CIDR(entry: string): boolean {
  return /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(\/[0-9]+)?$/.test(entry)
}

function isIPv6(entry: string): boolean {
  return entry.includes(":")
}

async function addEntryToIpsets(
  allowSet: string,
  allowSet6: string,
  entry: string
): Promise<void> {
  if(isIPv4CIDR(entry)) {
    await addToIpset(allowSet, entry)
  } else if(isIPv6(entry)) {
    await addToIpset(allowSet6, entry)
  } else {
    const { v4, v6 } = await resolveDomain(entry)
    for(const ip of v4) await addToIpset(allowSet, ip)
    for(const ip of v6) await addToIpset(allowSet6, ip)
  }
}

// ── CA certificate setup ──────────────────────────────────────────────────────

async function setupCA(): Promise<void> {
  console.info("[setup] Generating CA certificate...")

  // http-mitm-proxy expects: certs/ca.pem, keys/ca.private.key, keys/ca.public.key
  await run(["mkdir", "-p", `${CA_DIR}/certs`, `${CA_DIR}/keys`])
  await run(["openssl", "genrsa", "-out", `${CA_DIR}/keys/ca.private.key`, "2048"])
  await run(["openssl", "rsa", "-in", `${CA_DIR}/keys/ca.private.key`, "-pubout", "-out", `${CA_DIR}/keys/ca.public.key`])
  await run([
    "openssl", "req", "-new", "-x509",
    "-days", "3650",
    "-key", `${CA_DIR}/keys/ca.private.key`,
    "-out", `${CA_DIR}/certs/ca.pem`,
    "-subj", "/CN=secure-vibe-mitm/O=secure-vibe"
  ])

  // Private key: only mitm can read; cert + public key: world-readable for NODE_EXTRA_CA_CERTS
  await run(["chmod", "600", `${CA_DIR}/keys/ca.private.key`])
  await run(["chmod", "644", `${CA_DIR}/keys/ca.public.key`, `${CA_DIR}/certs/ca.pem`])
  // useradd -r creates home dirs with mode 700; make it traversable so viber can read certs/ca.pem
  await run(["chmod", "755", "/home/mitm", CA_DIR, `${CA_DIR}/certs`])
  await run(["chown", "-R", "mitm:mitm", CA_DIR])

  // Install CA into system trust store (for curl, apt, pip, etc.)
  await run(["cp", `${CA_DIR}/certs/ca.pem`, "/usr/local/share/ca-certificates/claude-mitm-ca.crt"])
  await run(["update-ca-certificates"])

  console.info("[setup] CA certificate ready.")
}

// ── iptables/ipset initialization ─────────────────────────────────────────────

async function setupFirewall(): Promise<void> {
  console.info("[firewall] Initializing...")

  // Save Docker's internal DNS NAT rules before flushing
  const natSave = Bun.spawn(["iptables-save", "-t", "nat"], { stdout: "pipe" })
  const natOutput = await new Response(natSave.stdout).text()
  const dockerDnsRules = natOutput
    .split("\n")
    .filter(line => line.includes("127.0.0.11"))

  // Flush all rules
  await run(["iptables", "-F"])
  await run(["iptables", "-X"])
  await run(["iptables", "-t", "nat", "-F"])
  await run(["iptables", "-t", "nat", "-X"])
  await run(["iptables", "-t", "mangle", "-F"])
  await run(["iptables", "-t", "mangle", "-X"])
  await runOptional(["ip6tables", "-F"])
  await runOptional(["ip6tables", "-X"])
  await runOptional(["ip6tables", "-t", "mangle", "-F"])
  await runOptional(["ip6tables", "-t", "mangle", "-X"])

  // Destroy existing ipsets
  for(const setName of ["allowed-domains", "allowed-domains6", "blocked-domains", "blocked-domains6"]) {
    await runOptional(["ipset", "destroy", setName])
  }

  // Restore Docker DNS NAT rules
  if(dockerDnsRules.length > 0) {
    await runOptional(["iptables", "-t", "nat", "-N", "DOCKER_OUTPUT"])
    await runOptional(["iptables", "-t", "nat", "-N", "DOCKER_POSTROUTING"])
    for(const rule of dockerDnsRules) {
      const parts = rule.trim().split(/\s+/)
      if(parts.length > 0) {
        await runOptional(["iptables", "-t", "nat", ...parts])
      }
    }
  }

  // Early accepts — before DROP policy, needed for DNS resolution below
  for(const proto of ["udp", "tcp"]) {
    await run(["iptables", "-A", "OUTPUT", "-p", proto, "--dport", "53", "-j", "ACCEPT"])
    await run(["iptables", "-A", "INPUT", "-p", proto, "--sport", "53", "-j", "ACCEPT"])
    await runOptional(["ip6tables", "-A", "OUTPUT", "-p", proto, "--dport", "53", "-j", "ACCEPT"])
    await runOptional(["ip6tables", "-A", "INPUT", "-p", proto, "--sport", "53", "-j", "ACCEPT"])
  }
  await run(["iptables", "-A", "INPUT", "-i", "lo", "-j", "ACCEPT"])
  await run(["iptables", "-A", "OUTPUT", "-o", "lo", "-j", "ACCEPT"])
  await runOptional(["ip6tables", "-A", "INPUT", "-i", "lo", "-j", "ACCEPT"])
  await runOptional(["ip6tables", "-A", "OUTPUT", "-o", "lo", "-j", "ACCEPT"])

  // Create ipsets
  await run(["ipset", "create", "allowed-domains", "hash:net"])
  await run(["ipset", "create", "allowed-domains6", "hash:net", "family", "inet6"])
  await run(["ipset", "create", "blocked-domains", "hash:net"])
  await run(["ipset", "create", "blocked-domains6", "hash:net", "family", "inet6"])

  // GitHub IP ranges from api.github.com/meta
  console.info("[firewall] Fetching GitHub IP ranges...")
  try {
    const response = await fetch("https://api.github.com/meta", {
      signal: AbortSignal.timeout(10000)
    })
    if(response.ok) {
      const meta = await response.json() as Record<string, string[]>
      const cidrs = [
        ...(meta.web ?? []),
        ...(meta.api ?? []),
        ...(meta.git ?? []),
        ...(meta.packages ?? [])
      ]
      for(const cidr of cidrs) {
        if(isIPv6(cidr)) {
          await addToIpset("allowed-domains6", cidr)
        } else {
          await addToIpset("allowed-domains", cidr)
        }
      }
      console.info("[firewall] GitHub IP ranges added.")
    } else {
      throw new Error(`HTTP ${response.status}`)
    }
  } catch(error: unknown) {
    console.warn("[firewall] GitHub meta unavailable, falling back to DNS")
    for(const domain of ["github.com", "raw.githubusercontent.com", "ghcr.io", "api.github.com"]) {
      await addEntryToIpsets("allowed-domains", "allowed-domains6", domain)
    }
  }

  // Cloudflare IP ranges (covers npmjs, sentry, statsig, brew, and many CDN-hosted sites)
  console.info("[firewall] Fetching Cloudflare IP ranges...")
  try {
    const [v4Response, v6Response] = await Promise.all([
      fetch("https://www.cloudflare.com/ips-v4", { signal: AbortSignal.timeout(10000) }),
      fetch("https://www.cloudflare.com/ips-v6", { signal: AbortSignal.timeout(10000) })
    ])
    if(v4Response.ok) {
      const text = await v4Response.text()
      for(const cidr of text.split("\n").map(line => line.trim()).filter(Boolean)) {
        await addToIpset("allowed-domains", cidr)
      }
      console.info("[firewall] Cloudflare IPv4 ranges added.")
    }
    if(v6Response.ok) {
      const text = await v6Response.text()
      for(const cidr of text.split("\n").map(line => line.trim()).filter(Boolean)) {
        await addToIpset("allowed-domains6", cidr)
      }
      console.info("[firewall] Cloudflare IPv6 ranges added.")
    }
  } catch(error: unknown) {
    console.warn("[firewall] Cloudflare IP ranges unavailable, falling back to DNS")
  }

  // Fastly IP ranges (stackoverflow, reddit, pypi, crates.io, and others)
  console.info("[firewall] Fetching Fastly IP ranges...")
  try {
    const response = await fetch("https://api.fastly.com/public-ip-list", {
      signal: AbortSignal.timeout(10000)
    })
    if(response.ok) {
      const data = await response.json() as { addresses?: string[], ipv6_addresses?: string[] }
      for(const cidr of data.addresses ?? []) await addToIpset("allowed-domains", cidr)
      for(const cidr of data.ipv6_addresses ?? []) await addToIpset("allowed-domains6", cidr)
      console.info("[firewall] Fastly IP ranges added.")
    } else {
      throw new Error(`HTTP ${response.status}`)
    }
  } catch(error: unknown) {
    console.warn("[firewall] Fastly IP ranges unavailable, falling back to DNS")
    for(const domain of ["stackoverflow.com", "reddit.com", "pypi.org", "crates.io"]) {
      await addEntryToIpsets("allowed-domains", "allowed-domains6", domain)
    }
  }

  // Default allowed domains
  console.info("[firewall] Resolving default allowed domains...")
  for(const domain of DEFAULT_ALLOWLIST) {
    await addEntryToIpsets("allowed-domains", "allowed-domains6", domain)
  }

  // Docker bridge subnet (host network /24)
  const routeProc = Bun.spawn(["ip", "route", "show", "default"], { stdout: "pipe" })
  const routeOutput = await new Response(routeProc.stdout).text()
  const gatewayMatch = routeOutput.match(/via\s+(\d+\.\d+\.\d+)\.\d+/)
  if(gatewayMatch) {
    const hostSubnet = `${gatewayMatch.at(1)}.0/24`
    await addToIpset("allowed-domains", hostSubnet)
    console.info(`[firewall] Host subnet: ${hostSubnet}`)
  }

  // FIREWALL_ALLOW / FIREWALL_BLOCK env vars
  const { extraAllow, extraBlock } = parseFirewallEnv()
  if(extraAllow.length > 0) {
    console.info("[firewall] Processing FIREWALL_ALLOW...")
    for(const entry of extraAllow) {
      console.info(`[firewall] Allowing: ${entry}`)
      await addEntryToIpsets("allowed-domains", "allowed-domains6", entry)
    }
  }
  if(extraBlock.length > 0) {
    console.info("[firewall] Processing FIREWALL_BLOCK...")
    for(const entry of extraBlock) {
      console.info(`[firewall] Blocking: ${entry}`)
      await addEntryToIpsets("blocked-domains", "blocked-domains6", entry)
    }
  }

  // Default DROP policies
  await run(["iptables", "-P", "INPUT", "DROP"])
  await run(["iptables", "-P", "FORWARD", "DROP"])
  await run(["iptables", "-P", "OUTPUT", "DROP"])
  await runOptional(["ip6tables", "-P", "INPUT", "DROP"])
  await runOptional(["ip6tables", "-P", "FORWARD", "DROP"])
  await runOptional(["ip6tables", "-P", "OUTPUT", "DROP"])

  // IPv4 filter rules
  await run(["iptables", "-A", "INPUT", "-m", "state", "--state", "ESTABLISHED,RELATED", "-j", "ACCEPT"])
  await run(["iptables", "-A", "OUTPUT", "-m", "state", "--state", "ESTABLISHED,RELATED", "-j", "ACCEPT"])
  await run(["iptables", "-A", "OUTPUT", "-m", "set", "--match-set", "blocked-domains", "dst", "-j", "REJECT", "--reject-with", "icmp-admin-prohibited"])
  await run(["iptables", "-A", "OUTPUT", "-m", "set", "--match-set", "allowed-domains", "dst", "-j", "ACCEPT"])
  await run(["iptables", "-A", "OUTPUT", "-j", "REJECT", "--reject-with", "icmp-admin-prohibited"])

  // IPv6 filter rules
  await runOptional(["ip6tables", "-A", "INPUT", "-m", "state", "--state", "ESTABLISHED,RELATED", "-j", "ACCEPT"])
  await runOptional(["ip6tables", "-A", "OUTPUT", "-m", "state", "--state", "ESTABLISHED,RELATED", "-j", "ACCEPT"])
  await runOptional(["ip6tables", "-A", "OUTPUT", "-m", "set", "--match-set", "blocked-domains6", "dst", "-j", "REJECT", "--reject-with", "icmp6-adm-prohibited"])
  await runOptional(["ip6tables", "-A", "OUTPUT", "-m", "set", "--match-set", "allowed-domains6", "dst", "-j", "ACCEPT"])
  await runOptional(["ip6tables", "-A", "OUTPUT", "-j", "REJECT", "--reject-with", "icmp6-adm-prohibited"])

  console.info("[firewall] Done. Outbound: allowlist (IPv4 + IPv6), explicit proxy on :8080.")
}

// ── Entry ─────────────────────────────────────────────────────────────────────

export async function runSetup(): Promise<void> {
  try {
    await setupCA()
    await setupFirewall()
  } catch(error: unknown) {
    console.error("[setup] Fatal error:", error)
    process.exit(1)
  }
}
