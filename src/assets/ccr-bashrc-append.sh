
# secure-vibe: re-assert /home/viber/bin ahead of ~/.local/bin and ~/.bun/bin on PATH
# so `ccr` and `claude` resolve to our wrappers, then clear bash's command hash so the
# lookup re-resolves.
export PATH="/home/viber/bin:$PATH"
hash -r 2>/dev/null || true

# Gateway endpoint + token, written by the entrypoint once `ccr serve` is up.
[[ -f /home/viber/.secure-vibe-ccr.env ]] && . /home/viber/.secure-vibe-ccr.env

# Auto-start on the first interactive shell (resolves to the claude wrapper).
if [[ $SHLVL -eq 1 && -z "${SECURE_VIBE_EXPLICIT_CMD:-}" ]]; then
  ccr || true
  echo ""
  echo "CCR exited. Type 'ccr' to restart."
fi
