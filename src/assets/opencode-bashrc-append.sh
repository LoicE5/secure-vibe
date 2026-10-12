export PATH="/home/viber/bin:$PATH"
hash -r 2>/dev/null || true

if [[ $SHLVL -eq 1 && -z "${SECURE_VIBE_EXPLICIT_CMD:-}" && -z "${SECURE_VIBE_OPENCODE_STARTED:-}" ]]; then
  export SECURE_VIBE_OPENCODE_STARTED=1
  opencode || true
  echo ""
  echo "OpenCode exited. Type 'opencode' to restart, or 'opencode-default' for normal approvals."
fi
