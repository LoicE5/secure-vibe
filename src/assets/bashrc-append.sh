
# secure-vibe: auto-start claude on first shell
if [[ $SHLVL -eq 1 && -z "${SECURE_VIBE_EXPLICIT_CMD:-}" ]]; then
  claude || true
  echo ""
  echo "Claude exited. Type 'claude' to restart."
fi
