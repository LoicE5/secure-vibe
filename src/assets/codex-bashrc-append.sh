
# secure-vibe: re-assert /home/viber/bin last so `codex` resolves to our wrapper, and
# clear bash's command hash so the lookup re-resolves.
export PATH="/home/viber/bin:$PATH"
hash -r 2>/dev/null || true

if [[ $SHLVL -eq 1 && -z "${SECURE_VIBE_EXPLICIT_CMD:-}" ]]; then
  codex || true
  echo ""
  echo "Codex exited. Type 'codex' to restart."
fi
