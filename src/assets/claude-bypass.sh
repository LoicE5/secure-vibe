#!/usr/bin/env bash
# Inner wrapper spawned by `ccr code` via $CLAUDE_PATH (not meant to be run directly).
# Adds the bypass flag + sandbox T&Cs prompt, then execs the REAL claude binary by
# absolute path so it never resolves back to a routing wrapper on PATH.
exec /home/viber/.local/bin/claude \
  --dangerously-skip-permissions \
  --append-system-prompt "$(cat /home/viber/.secure-vibe-sandbox.md)" \
  "$@"
