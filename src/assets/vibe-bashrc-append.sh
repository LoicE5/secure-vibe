
# secure-vibe: re-assert /home/viber/bin last so `vibe` resolves to our wrapper, and
# clear bash's command hash so the lookup re-resolves.
export PATH="/home/viber/bin:$PATH"
hash -r 2>/dev/null || true

if [[ $SHLVL -eq 1 && -z "${SECURE_VIBE_EXPLICIT_CMD:-}" ]]; then
  vibe || true
  echo ""
  echo "Vibe exited. Type 'vibe' to restart."
fi
