# secure-vibe: auto-start antigravity on first shell
if [[ $SHLVL -eq 1 && -z "${SECURE_VIBE_EXPLICIT_CMD:-}" ]]; then
  agy || true
  echo ""
  echo "Antigravity exited. Type 'agy' to restart."
fi
