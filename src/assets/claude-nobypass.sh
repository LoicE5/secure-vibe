#!/usr/bin/env bash
# Inner wrapper spawned by `ccr code` via $CLAUDE_PATH for `claude-default` (not meant to
# be run directly). Same as claude-bypass but WITHOUT --dangerously-skip-permissions, so
# Claude Code keeps its normal permission prompts. Still appends the sandbox T&Cs prompt
# and execs the REAL claude binary by absolute path (no recursion).
exec /home/viber/.local/bin/claude \
  --append-system-prompt "$(cat /home/viber/.secure-vibe-sandbox.md)" \
  "$@"
