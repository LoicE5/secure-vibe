#!/bin/bash
set -euo pipefail
IFS=$'\n\t'

echo "[firewall] Initializing..."

# ── Save Docker's internal DNS NAT rules before flushing ────────────────────
DOCKER_DNS_RULES=$(iptables-save -t nat | grep "127\.0\.0\.11" || true)

# ── Flush all rules ──────────────────────────────────────────────────────────
iptables  -F && iptables  -X
iptables  -t nat    -F && iptables  -t nat    -X
iptables  -t mangle -F && iptables  -t mangle -X
ip6tables -F && ip6tables -X 2>/dev/null || true
ip6tables -t mangle -F && ip6tables -t mangle -X 2>/dev/null || true

# ── Destroy existing ipsets ──────────────────────────────────────────────────
for setName in allowed-domains allowed-domains6 blocked-domains blocked-domains6; do
  ipset destroy "$setName" 2>/dev/null || true
done

# ── Restore Docker DNS NAT rules ────────────────────────────────────────────
if [ -n "$DOCKER_DNS_RULES" ]; then
  iptables -t nat -N DOCKER_OUTPUT      2>/dev/null || true
  iptables -t nat -N DOCKER_POSTROUTING 2>/dev/null || true
  while IFS= read -r rule; do iptables -t nat $rule; done <<< "$DOCKER_DNS_RULES"
fi

# ── Early accepts (before DROP policy — needed for DNS resolution below) ────
for proto in udp tcp; do
  iptables  -A OUTPUT -p "$proto" --dport 53 -j ACCEPT
  iptables  -A INPUT  -p "$proto" --sport 53 -j ACCEPT
  ip6tables -A OUTPUT -p "$proto" --dport 53 -j ACCEPT 2>/dev/null || true
  ip6tables -A INPUT  -p "$proto" --sport 53 -j ACCEPT 2>/dev/null || true
done
iptables  -A OUTPUT -p tcp --dport 22 -j ACCEPT
iptables  -A INPUT  -p tcp --sport 22 -m state --state ESTABLISHED -j ACCEPT
ip6tables -A OUTPUT -p tcp --dport 22 -j ACCEPT 2>/dev/null || true
ip6tables -A INPUT  -p tcp --sport 22 -m state --state ESTABLISHED -j ACCEPT 2>/dev/null || true
iptables  -A INPUT  -i lo -j ACCEPT && iptables  -A OUTPUT -o lo -j ACCEPT
ip6tables -A INPUT  -i lo -j ACCEPT 2>/dev/null || true
ip6tables -A OUTPUT -o lo -j ACCEPT 2>/dev/null || true

# ── Create ipsets ────────────────────────────────────────────────────────────
ipset create allowed-domains  hash:net
ipset create allowed-domains6 hash:net family inet6
ipset create blocked-domains  hash:net
ipset create blocked-domains6 hash:net family inet6

# ── Helpers ──────────────────────────────────────────────────────────────────
function add_a_records() {
  local setName="$1" domain="$2" ips
  ips=$(dig +short +time=3 +tries=2 A "$domain" 2>/dev/null | grep -E '^[0-9]+\.' || true)
  if [ -z "$ips" ]; then echo "[firewall] Warning: no A records for $domain"; return 0; fi
  while IFS= read -r ip; do ipset add "$setName" "$ip" 2>/dev/null || true; done <<< "$ips"
}

function add_aaaa_records() {
  local setName="$1" domain="$2" ips
  ips=$(dig +short +time=3 +tries=2 AAAA "$domain" 2>/dev/null | grep -E '^[0-9a-fA-F:]+$' || true)
  [ -z "$ips" ] && return 0
  while IFS= read -r ip; do ipset add "$setName" "$ip" 2>/dev/null || true; done <<< "$ips"
}

function add_entry_to_ipsets() {
  local allowSet="$1" allowSet6="$2" entry="$3"
  if [[ "$entry" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(\/[0-9]+)?$ ]]; then
    ipset add "$allowSet" "$entry" 2>/dev/null || true
  elif [[ "$entry" =~ : ]]; then
    ipset add "$allowSet6" "$entry" 2>/dev/null || true
  else
    add_a_records    "$allowSet"  "$entry"
    add_aaaa_records "$allowSet6" "$entry"
  fi
}

# ── GitHub IP ranges (IPv4 + IPv6 CIDRs from api.github.com/meta) ───────────
echo "[firewall] Fetching GitHub IP ranges..."
GH_META=$(curl -sf --max-time 10 https://api.github.com/meta || true)
if [ -n "$GH_META" ]; then
  while IFS= read -r cidr; do
    if [[ "$cidr" =~ : ]]; then
      ipset add allowed-domains6 "$cidr" 2>/dev/null || true
    else
      ipset add allowed-domains  "$cidr" 2>/dev/null || true
    fi
  done < <(echo "$GH_META" | jq -r '(.web + .api + .git + (.packages // []))[]' 2>/dev/null || true)
  echo "[firewall] GitHub IP ranges added."
else
  echo "[firewall] Warning: GitHub meta unavailable, falling back to DNS"
  for domain in "github.com" "raw.githubusercontent.com" "ghcr.io" "api.github.com"; do
    add_a_records    "allowed-domains"  "$domain"
    add_aaaa_records "allowed-domains6" "$domain"
  done
fi

# ── Default allowed domains ──────────────────────────────────────────────────
echo "[firewall] Resolving default allowed domains..."
for domain in \
  "api.anthropic.com" \
  "sentry.io" \
  "statsig.anthropic.com" \
  "statsig.com" \
  "registry.npmjs.org" \
  "formulae.brew.sh" \
  "pypi.org" \
  "files.pythonhosted.org"; do
  add_a_records    "allowed-domains"  "$domain"
  add_aaaa_records "allowed-domains6" "$domain"
done

# ── Host network /24 (Docker bridge subnet) ─────────────────────────────────
DEFAULT_GW=$(ip route show default 2>/dev/null | awk '{print $3}' | head -1 || true)
if [ -n "$DEFAULT_GW" ]; then
  HOST_SUBNET=$(echo "$DEFAULT_GW" | awk -F. '{print $1"."$2"."$3".0/24"}')
  ipset add allowed-domains "$HOST_SUBNET" 2>/dev/null || true
  echo "[firewall] Host subnet: $HOST_SUBNET"
fi

# ── FIREWALL_ALLOW ───────────────────────────────────────────────────────────
if [ -n "${FIREWALL_ALLOW:-}" ]; then
  echo "[firewall] Processing FIREWALL_ALLOW..."
  IFS=',' read -ra ENTRIES <<< "$FIREWALL_ALLOW"
  for entry in "${ENTRIES[@]}"; do
    entry=$(echo "$entry" | tr -d '[:space:]')
    [ -z "$entry" ] && continue
    echo "[firewall] Allowing: $entry"
    add_entry_to_ipsets "allowed-domains" "allowed-domains6" "$entry"
  done
fi

# ── FIREWALL_BLOCK ───────────────────────────────────────────────────────────
if [ -n "${FIREWALL_BLOCK:-}" ]; then
  echo "[firewall] Processing FIREWALL_BLOCK..."
  IFS=',' read -ra ENTRIES <<< "$FIREWALL_BLOCK"
  for entry in "${ENTRIES[@]}"; do
    entry=$(echo "$entry" | tr -d '[:space:]')
    [ -z "$entry" ] && continue
    echo "[firewall] Blocking: $entry"
    add_entry_to_ipsets "blocked-domains" "blocked-domains6" "$entry"
  done
fi

# ── Default DROP policies ────────────────────────────────────────────────────
iptables  -P INPUT DROP && iptables  -P FORWARD DROP && iptables  -P OUTPUT DROP
ip6tables -P INPUT DROP && ip6tables -P FORWARD DROP && ip6tables -P OUTPUT DROP 2>/dev/null || true

# ── IPv4 rules ───────────────────────────────────────────────────────────────
iptables -A INPUT  -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m set --match-set blocked-domains dst -j REJECT --reject-with icmp-admin-prohibited
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT
iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited

# ── IPv6 rules ───────────────────────────────────────────────────────────────
if command -v ip6tables >/dev/null 2>&1; then
  ip6tables -A INPUT  -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true
  ip6tables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true
  ip6tables -A OUTPUT -m set --match-set blocked-domains6 dst -j REJECT --reject-with icmp6-adm-prohibited 2>/dev/null || true
  ip6tables -A OUTPUT -m set --match-set allowed-domains6 dst -j ACCEPT 2>/dev/null || true
  ip6tables -A OUTPUT -j REJECT --reject-with icmp6-adm-prohibited 2>/dev/null || true
  echo "[firewall] IPv6 rules applied."
fi

echo "[firewall] Done. Outbound: whitelist only (IPv4 + IPv6)."
