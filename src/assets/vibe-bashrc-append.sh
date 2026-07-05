
# secure-vibe: re-assert /home/viber/bin ahead of ~/.local/bin on PATH so `vibe`
# resolves to our wrapper (which adds --yolo), then clear bash's command hash so
# the lookup re-resolves.
export PATH="/home/viber/bin:$PATH"
hash -r 2>/dev/null || true

# Auto-start vibe on first interactive shell (now resolves to the wrapper).
if [[ $SHLVL -eq 1 && -z "${SECURE_VIBE_EXPLICIT_CMD:-}" ]]; then
  vibe || true
  echo ""
  echo "Vibe exited. Type 'vibe' to restart."
fi
