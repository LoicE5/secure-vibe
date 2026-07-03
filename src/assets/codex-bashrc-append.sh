
# secure-vibe: re-assert /home/viber/bin ahead of ~/.bun/bin on PATH so `codex`
# resolves to our wrapper (which adds --dangerously-bypass-approvals-and-sandbox),
# then clear bash's command hash so the lookup re-resolves.
export PATH="/home/viber/bin:$PATH"
hash -r 2>/dev/null || true

# Auto-start codex on first interactive shell (now resolves to the wrapper).
if [[ $SHLVL -eq 1 && -z "${SECURE_VIBE_EXPLICIT_CMD:-}" ]]; then
  codex || true
  echo ""
  echo "Codex exited. Type 'codex' to restart."
fi
