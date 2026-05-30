#!/usr/bin/env bash
exec /home/viber/.local/bin/claude \
  --dangerously-skip-permissions \
  --append-system-prompt "$(cat /home/viber/.secure-vibe-sandbox.md)" \
  "$@"
