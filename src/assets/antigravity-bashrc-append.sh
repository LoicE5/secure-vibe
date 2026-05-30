# secure-vibe: the agy installer prepends ~/.local/bin to PATH in .bashrc, which
# shadows our wrapper at /home/viber/bin (the wrapper adds --dangerously-skip-
# permissions). This block runs last, so re-assert /home/viber/bin ahead of the
# real binary and clear bash's command hash so `agy` resolves to the wrapper.
export PATH="/home/viber/bin:$PATH"
hash -r 2>/dev/null || true

# Auto-start antigravity on first interactive shell (now resolves to the wrapper).
if [[ $SHLVL -eq 1 && -z "${SECURE_VIBE_EXPLICIT_CMD:-}" ]]; then
  agy || true
  echo ""
  echo "Antigravity exited. Type 'agy' to restart."
fi
