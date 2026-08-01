#!/usr/bin/env bash
# End-to-end test suite for the CCR provider.
#
#   bash scripts/test-ccr.sh          # read-only checks + a real round trip
#   bash scripts/test-ccr.sh --full   # also exercises the failure path (backs up your config)
#
# Runs in two modes: on the host it drives the container, and inside the container it runs the
# runtime suite (the repo is mounted, so it is the same file both times).
set -uo pipefail

PASS=0; FAIL=0; SKIP=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; [ $# -gt 1 ] && printf '        %s\n' "$2"; FAIL=$((FAIL+1)); }
skip() { printf '  \033[33mSKIP\033[0m  %s\n' "$1"; SKIP=$((SKIP+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ─────────────────────────────────────────────────────────────────────────────
# In-container suite
# ─────────────────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--in-container" ]; then
  head_ "Runtime environment"
  [ -n "${ANTHROPIC_BASE_URL:-}" ] && ok "ANTHROPIC_BASE_URL=$ANTHROPIC_BASE_URL" || bad "ANTHROPIC_BASE_URL unset"
  [ -n "${ANTHROPIC_AUTH_TOKEN:-}" ] && ok "ANTHROPIC_AUTH_TOKEN set" || bad "ANTHROPIC_AUTH_TOKEN unset"
  [ -n "${ANTHROPIC_MODEL:-}" ] && ok "ANTHROPIC_MODEL=${ANTHROPIC_MODEL:-}" || bad "ANTHROPIC_MODEL unset"
  [ -n "${ANTHROPIC_DEFAULT_HAIKU_MODEL:-}" ] \
    && ok "ANTHROPIC_DEFAULT_HAIKU_MODEL set (background calls mapped)" \
    || bad "ANTHROPIC_DEFAULT_HAIKU_MODEL unset" "background calls will 400 mid-session"
  [ "${CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY:-}" = "1" ] \
    && ok "gateway model discovery enabled" \
    || bad "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY not set" "Claude Code will reject the model id"
  [ -f /home/viber/.secure-vibe-ccr.env ] && ok "env file present (docker exec works)" || bad "env file missing"

  if [ -z "${ANTHROPIC_BASE_URL:-}" ]; then
    printf '\n  Core env is missing — the rest of the suite cannot run.\n'
    printf '  Run this through the CLI: bun src/index.ts --ccr --command "bash scripts/test-ccr.sh --in-container"\n'
    exit 1
  fi

  head_ "Least privilege"
  if [ -n "${SECRET_UNUSED_DECOY:-}" ]; then
    bad "decoy variable leaked into the container" "SECRET_UNUSED_DECOY should not be forwarded"
  else
    ok "unreferenced host variable not forwarded"
  fi

  head_ "Gateway"
  health=$(curl -s --max-time 5 "${ANTHROPIC_BASE_URL:-}/health")
  case "$health" in
    *'"status":"running"'*) ok "/health reports running" ;;
    *'"status":"starting"'*) bad "/health still starting" "$health" ;;
    *) bad "/health unreachable" "$health" ;;
  esac

  models=$(curl -s --max-time 10 "${ANTHROPIC_BASE_URL:-}/v1/models" -H "x-api-key: ${ANTHROPIC_AUTH_TOKEN:-}")
  case "$models" in
    *"\"${ANTHROPIC_MODEL:-}\""*) ok "gateway advertises ${ANTHROPIC_MODEL:-}" ;;
    *) bad "gateway does not advertise ${ANTHROPIC_MODEL:-}" "$(printf '%s' "$models" | head -c 300)" ;;
  esac

  head_ "Round trip (this is the real gate)"
  body=$(printf '{"model":"%s","max_tokens":32,"messages":[{"role":"user","content":"Reply with the single word: pong"}]}' "${ANTHROPIC_MODEL:-}")
  resp=$(curl -s --max-time 90 -X POST "${ANTHROPIC_BASE_URL:-}/v1/messages" \
    -H 'content-type: application/json' -H "x-api-key: ${ANTHROPIC_AUTH_TOKEN:-}" -d "$body")
  case "$resp" in
    *'"error"'*) bad "gateway /v1/messages returned an error" "$(printf '%s' "$resp" | head -c 400)" ;;
    *'"content"'*) ok "gateway /v1/messages returned a completion" ;;
    *) bad "unexpected /v1/messages response" "$(printf '%s' "$resp" | head -c 300)" ;;
  esac

  out=$(timeout 180 claude -p "Reply with the single word: pong" 2>&1)
  case "$out" in
    *[Pp]ong*) ok "claude -p round trip through the gateway" ;;
    *) bad "claude -p failed" "$(printf '%s' "$out" | head -c 400)" ;;
  esac

  head_ "Tool use"
  rm -f /tmp/ccr-tooltest.txt
  out=$(timeout 240 claude -p 'Create the file /tmp/ccr-tooltest.txt containing exactly the word banana, then read it back.' 2>&1)
  if [ -f /tmp/ccr-tooltest.txt ] && grep -qi banana /tmp/ccr-tooltest.txt; then
    ok "write + read tool calls succeeded"
  else
    bad "tool calls did not produce the file" "$(printf '%s' "$out" | head -c 400)"
  fi
  rm -f /tmp/ccr-tooltest.txt

  head_ "Background calls"
  count=$(grep -c '400' "$HOME/.ccr-serve.log" 2>/dev/null || echo 0)
  [ "$count" = "0" ] && ok "no 400s in ~/.ccr-serve.log" || bad "$count occurrences of 400 in ~/.ccr-serve.log" "check the Haiku mapping"

  head_ "Config handling"
  [ -f "$HOME/.claude-code-router/config.json" ] \
    && skip "config.json still present (CCR normally consumes it)" \
    || ok "config.json imported and consumed by CCR"

  printf '\n\033[1mcontainer: %d passed, %d failed, %d skipped\033[0m\n' "$PASS" "$FAIL" "$SKIP"
  [ "$FAIL" -eq 0 ] || exit 1
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Host driver
# ─────────────────────────────────────────────────────────────────────────────
FULL=0
[ "${1:-}" = "--full" ] && FULL=1

CFG="$HOME/.claude-code-router/config.json"
IMAGE="ghcr.io/loice5/secure-vibe/ccr:latest"
CLI="bun src/index.ts"

# macOS ships shasum, Linux sha256sum
sha() {
  if command -v shasum >/dev/null; then shasum -a 256 "$1" | awk '{print $1}'
  else sha256sum "$1" | awk '{print $1}'; fi
}

head_ "Host preflight"
command -v docker >/dev/null && ok "docker on PATH" || { bad "docker not found"; exit 1; }
docker info >/dev/null 2>&1 && ok "docker daemon reachable" || { bad "docker daemon not running"; exit 1; }
docker image inspect "$IMAGE" >/dev/null 2>&1 && ok "image present" || bad "image missing" "run: bun run docker:build:ccr"
[ -f "$CFG" ] && ok "host config exists" || { bad "no config at $CFG"; exit 1; }
bun -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$CFG" 2>/dev/null \
  && ok "host config is valid JSON" || { bad "host config is not valid JSON"; exit 1; }

head_ "Config sanity"
bun -e '
const fs = require("fs")
const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
const sel = v => typeof v === "string" && v.includes(",") ? v.replace(",", "/") : v
const served = (cfg.Providers ?? []).flatMap(p => (p.models ?? []).map(m => `${p.name}/${m}`))
const wanted = [sel(cfg.Router?.default), sel(cfg.Router?.background)].filter(Boolean)
let bad = 0
for (const w of wanted) {
  if (served.includes(w)) console.log(`  PASS  Router slot ${w} is served`)
  else { console.log(`  FAIL  Router slot ${w} is NOT in any provider models list`); bad++ }
}
console.log(`  INFO  served: ${served.join(", ")}`)
process.exit(bad ? 1 : 0)
' "$CFG"
[ $? -eq 0 ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))

# The check that would have saved the most time: does the model still exist upstream?
if curl -s --max-time 20 https://openrouter.ai/api/v1/models -o /tmp/ccr-or-models.json 2>/dev/null; then
  bun -e '
  const fs = require("fs")
  const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
  const live = new Set(JSON.parse(fs.readFileSync("/tmp/ccr-or-models.json","utf8")).data.map(m => m.id))
  let bad = 0
  for (const p of cfg.Providers ?? []) {
    if (!/openrouter\.ai/.test(p.api_base_url ?? "")) continue
    for (const m of p.models ?? []) {
      if (live.has(m)) console.log(`  PASS  OpenRouter model exists: ${m}`)
      else { console.log(`  FAIL  OpenRouter model NOT FOUND (retired?): ${m}`); bad++ }
    }
  }
  process.exit(bad ? 1 : 0)
  ' "$CFG"
  [ $? -eq 0 ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
else
  skip "could not reach OpenRouter to validate model ids"
fi

head_ "Image contents"
img=$(docker run --rm --entrypoint bash "$IMAGE" -c '
  ls -A ~/.claude-code-router 2>/dev/null | tr "\n" " "
  echo "|ABI=$(node -e "console.log(process.versions.modules)")"
  echo "|BINS=$(ls ~/bin | tr "\n" " ")"
  echo "|CLAUDE_PATH=${CLAUDE_PATH:-unset}"' 2>/dev/null)
case "$img" in
  *config.sqlite*) bad "config.sqlite baked into the image" "every run would ignore your mounted config" ;;
  *) ok "no CCR sqlite state baked into the image" ;;
esac
case "$img" in *ABI=127*|*ABI=137*) ok "node ABI has better-sqlite3 prebuilds" ;; *) bad "unexpected node ABI" "$img" ;; esac
case "$img" in *"claude-default"*) ok "wrappers installed" ;; *) bad "wrappers missing" "$img" ;; esac
case "$img" in *"CLAUDE_PATH=unset"*) ok "CLAUDE_PATH removed (2.x leftover)" ;; *) bad "CLAUDE_PATH still set" ;; esac
case "$img" in *"|BINS="*node*) bad "node->bun shim still present" "it shadows the real node CCR needs" ;; *) ok "no node->bun shim" ;; esac

head_ "Host config immutability"
before=$(sha "$CFG")

head_ "Container run"
SECRET_UNUSED_DECOY=leaked-if-forwarded $CLI --ccr --command 'bash scripts/test-ccr.sh --in-container'
container_rc=$?

after=$(sha "$CFG")
head_ "Host config immutability (verdict)"
[ "$before" = "$after" ] && ok "host config byte-identical after the run" || bad "HOST CONFIG WAS MODIFIED" "$before -> $after"

if [ "$FULL" = "1" ]; then
  head_ "Failure path (config with no models)"
  backup=$(mktemp)
  cp "$CFG" "$backup"
  trap 'cp "$backup" "$CFG"; rm -f "$backup"; echo "  (config restored)"' EXIT
  bun -e '
  const fs = require("fs"); const p = process.argv[1]
  const cfg = JSON.parse(fs.readFileSync(p, "utf8"))
  for (const prov of cfg.Providers ?? []) prov.models = []
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2))
  ' "$CFG"
  out=$($CLI --ccr --command 'echo SHELL_REACHED' 2>&1)
  case "$out" in
    *"No available models"*|*"at least one model"*) ok "empty models produces the targeted message" ;;
    *) bad "expected a 'no available models' message" "$(printf '%s' "$out" | tail -c 300)" ;;
  esac
  case "$out" in
    *SHELL_REACHED*) ok "shell still usable after gateway failure (non-fatal)" ;;
    *) bad "container died instead of dropping to a shell" ;;
  esac
  cp "$backup" "$CFG"; rm -f "$backup"; trap - EXIT
  echo "  (config restored)"
fi

printf '\n\033[1m════ host: %d passed, %d failed, %d skipped ════\033[0m\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ] && [ "$container_rc" -eq 0 ] || exit 1
echo "All green."
