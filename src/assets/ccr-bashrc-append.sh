
# secure-vibe: re-assert /home/viber/bin ahead of ~/.local/bin and ~/.bun/bin on PATH
# so `ccr` (and the `claude` it spawns) resolve to our wrappers, then clear bash's
# command hash so the lookup re-resolves.
export PATH="/home/viber/bin:$PATH"
hash -r 2>/dev/null || true

# Auto-start ccr on first interactive shell (now resolves to the wrapper → `ccr code`).
if [[ $SHLVL -eq 1 && -z "${SECURE_VIBE_EXPLICIT_CMD:-}" ]]; then
  ccr || true
  echo ""
  echo "CCR exited. Type 'ccr' to restart."
fi
