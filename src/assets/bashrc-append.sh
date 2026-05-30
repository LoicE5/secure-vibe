
# secure-vibe: the `claude-default` escape hatch (raw binary, no injected flags)
# is a symlink on PATH at /home/viber/bin/claude-default — no alias needed, so it
# also resolves in the non-interactive `bash -c` (--command) path. See the
# dockerfile note next to the symlink.

# secure-vibe: auto-start claude on first shell
if [[ $SHLVL -eq 1 && -z "${SECURE_VIBE_EXPLICIT_CMD:-}" ]]; then
  claude || true
  echo ""
  echo "Claude exited. Type 'claude' to restart."
fi
