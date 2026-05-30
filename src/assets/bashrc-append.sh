
# secure-vibe: claude escape hatch (raw binary, no injected flags)
alias claude-default='/home/viber/.local/bin/claude'

# secure-vibe: auto-start claude on first shell
if [[ $SHLVL -eq 1 && -z "${SECURE_VIBE_EXPLICIT_CMD:-}" ]]; then
  claude || true
  echo ""
  echo "Claude exited. Type 'claude' to restart."
fi
