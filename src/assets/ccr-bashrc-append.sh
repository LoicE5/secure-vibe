
# secure-vibe: re-assert /home/viber/bin last so `ccr` and `claude` resolve to our
# wrappers, and clear bash's command hash so the lookup re-resolves.
export PATH="/home/viber/bin:$PATH"
hash -r 2>/dev/null || true

# Gateway endpoint + token, written by the entrypoint once `ccr serve` is up.
[[ -f /home/viber/.secure-vibe-ccr.env ]] && . /home/viber/.secure-vibe-ccr.env

if [[ $SHLVL -eq 1 && -z "${SECURE_VIBE_EXPLICIT_CMD:-}" ]]; then
  ccr || true
  echo ""
  echo "CCR exited. Type 'ccr' to restart."
fi
